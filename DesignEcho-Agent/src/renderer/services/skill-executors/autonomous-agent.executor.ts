import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import {
    resolveToolUseVerdict,
    capabilityBlocksExecution
} from '../../../shared/model-capability-verdict';
import {
    classifyModelProviderFailure,
    ModelProviderCallError,
    type ModelProviderFailure
} from '../../../shared/model-provider-failure';
import { projectModelVisualPresentationReceiptRef } from '../../../shared/model-visual-presentation-receipt';
import {
    isHarnessManagedSubscriptionTimeout,
    shouldRetryAutonomousModelTransport
} from '../../../shared/model-provider-transport-policy';
import { readProviderTransportMetrics } from '../../../shared/provider-transport-metrics';
import { buildConversationalUnavailableMessage } from '../../../shared/conversational-unavailable-message';
import { sanitizeUserVisibleDiagnosticText } from '../../../shared/chat-response-cleaner';
import { buildCancelledAutonomousAgentResult } from './autonomous-agent-result-projection';
import {
    buildAgentCapabilityBaseline,
    buildRecommendedSkillFastPathBaseline,
    createAgentCapabilitySession,
    REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
    SEARCH_AGENT_CAPABILITIES_TOOL_NAME,
    type AgentCapabilitySession
} from '../agent-runtime/capability-session';
import type { Agent } from '../agent-runtime/agent';
import { collectAgentFinalDeliveryDebugProjection } from '../agent-runtime/final-delivery-artifact-collector';
import { readAgentVisualObservation } from '../agent-runtime/visual-observation-strategy';
import {
    publishDebugFinalArtifactPaths,
    publishDebugFinalDeliveryProjection
} from '../debug-final-artifact-sidecar';
import { resolveDebugProjectReferenceTransportMetadata } from '../debug-bridge-project-reference';
import {
    readAgentEnvironmentRecoveryToolNames,
    readAgentReActRecoveryToolNames
} from '../../../shared/agent-react-observation-contract';
import {
    DELEGATE_TOOL,
    TEAM_PIPELINE_TOOL,
    getDefaultAgentTools
} from '../agent-runtime/tool-schemas';
import { buildSkillToolSchemas, isSkillToolName, executeSkillTool } from './skill-tools';
import {
    getAgentMattingPausedMessage,
    isAgentMattingAtomicTool,
    isAgentMattingPaused
} from '../agent-orchestration/routing';
import type {
    AgentConfig,
    AgentCallbacks,
    AgentExecutionSummary,
    AgentRunResult,
    AgentToolCallLogEntry,
    AgenticArtifactCompletionContract,
    CallModelFn,
    CallModelStreamFn,
    ExecuteToolFn,
    ExecuteToolRuntimeContext,
    ModelTransportAttemptAccounting,
    RuntimeArtifactPublicationInput,
    ToolSchema
} from '../agent-runtime/types';
import {
    executeToolCall,
    type ToolCallExecutionOptions
} from '../tool-executor.service';
import { streamChatWithToolsAsync } from '../agent-tool-stream.service';
import { useAppStore } from '../../stores/app.store';
import {
    getModelById,
    isAgentMultimodalModelConfig,
    resolveModelThinkingEnabledForCall,
    type ModelConfig,
    type ModelReasoningEffort
} from '../../../shared/config/models.config';
import {
    formatChatWebSearchCompletedStep,
    formatChatWebSearchVisibleStep,
    toProviderNativeWebSearchIntent,
    type ChatWebSearchIntent
} from '../../../shared/chat-web-search-policy';
import { buildProviderNativeToolPlan } from '../../../shared/provider-native-tools';
import {
    resolveAgentModelTransport,
    shouldReplayProviderReasoningContent
} from '../../../shared/agent-model-transport-policy';
import {
    classifyAgentToolExecution,
    DESIGN_ECHO_TARGET_GUARD_ARGUMENT,
    EXACT_PROPERTY_EXECUTION_CONTEXT_TOOLS,
    isAgentHarnessControlTool,
    readObservedDocumentId,
    type ExactPropertyExecutionScope,
    type AgentToolExecutionTargetGuard
} from '../../../shared/agent-tool-execution-preflight';
import { buildAgentOperationLedger } from '../../../shared/agent-operation-ledger';
import {
    createGuardedAtomicToolExecutor,
    resolveSkillWorkflowTargetRebinding,
    SKILL_WORKFLOW_TARGET_REFRESH_TOOLS
} from '../../../shared/agent-skill-atomic-tool-execution';
import {
    findObservedPhotoshopMutationProof,
    readPhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import {
    extendTaskRunDocumentCreationEvidence,
    type TaskRunDocumentCreationEvidence
} from '../../../shared/task-run-document-creation-evidence';
import { getPhotoshopToolSkillSemantics } from '../../../shared/photoshop-tool-skill';
import { isSkillRoutingRecommendation } from '../../../shared/skill-routing';
import { evaluateGenericBlockingCardOwner } from '../../../shared/agent-interaction-owner-policy';
import {
    getSkillById,
    getSkillInternalToolNames,
    getSkillInternalToolOwnerIds,
    isSkillProviderInteractionOwner
} from '../../../shared/skills/skill-declarations';
import {
    DesignTeamCoordinator,
    DesignTeamWorkspace,
    getDesignTeammateDefinition,
    parseCriticVerdict,
    transferTrustedVisualReviewArtifact
} from '../design-teams';
import type {
    DesignTeamChildExecutionAllowance,
    DesignTeammateRole
} from '../../../shared/types/design-team.types';
import type { ConversationTaskType } from '../../../shared/model-selection';
import {
    deriveDesignTaskRunRecord,
    resolveDesignDisciplineContext,
    createDesignDisciplineState,
    applyDesignDisciplineProgress,
    evaluateDesignToolStateGuard,
    isAdvisoryDisciplineGuardResult,
    isRuntimeVisualReviewBlocked,
    isStructuralDesignReviewTool,
    type DesignDisciplineContext,
    type DesignDisciplineState
} from '../../../shared/design-discipline-runtime';
import {
    evaluateHumanConfirmationGate,
    buildPendingDestructiveActionCard,
    buildPendingDestructiveActionBlockResult
} from '../../../shared/pending-destructive-action-card';
import { evaluateDelegatedToolSafetyBlock } from '../../../shared/tool-safety-policy';
import {
    buildAgentRunRecord,
    type AgentRunConversationScope
} from '../../../shared/agent-run-record';
import {
    buildRunRecordResumeBrief,
    validateRunResumeContractBinding
} from '../../../shared/agent-run-resume';
import { AGENT_RESPONSE_PRESENTATION_PROMPT } from '../../../shared/agent-response-presentation';
import {
    buildRuntimeResumeContextAnchor,
    buildRuntimeResumeFreshnessProbeRequest,
    evaluateRuntimeActionPlanResumeFreshness,
    type RuntimeActionPlanResumeFreshness
} from '../../../shared/agent-runtime-v5/runtime-action-plan-resume-freshness';
import { markExternalContentTrust } from '../../../shared/external-content-trust';
import { resolveDesignIntentSignal } from '../../../shared/design-intent-signal';
import {
    buildDesignTaskTypePromptSection,
    getDesignTaskTypeSpec,
    getDesignTaskTypeSpecBySkillId,
    isRegisteredDesignTaskTypeId
} from '../../../shared/design-task-types';
import {
    decideQualityAwareReflexionReentry,
    buildQualityLoopHaltMessage,
    evaluateReflexionReviewProvenance,
    isCompletedAestheticImprovementHandoff
} from '../../../shared/reflexion-reentry-policy';
import type { DesignScorecard } from '../../../shared/design-quality-assertion';
import type { ReflexionHandoff } from '../../../shared/agent-runtime-v5/reflexion-contract';
import { readTrustedVisualReviewArtifact } from '../agent-runtime/trusted-visual-review-artifact';
import { getDesignEvaluationProfileVlmAssertions } from '../../../shared/agent-runtime-v5/design-evaluation-profiles';
import {
    isAgenticExecutionModel,
    listSkillManifests,
    normalizeRuntimeDesignWorkMode,
    resolveSkillRuntimeManifestSelection
} from '../../../shared/agent-runtime-v5/skill-runtime';
import {
    buildAgenticRuntimeBindingContext,
    buildAgenticRuntimeBindingContextItem,
    type AgenticRuntimeBindingContext
} from '../../../shared/agent-runtime-v5/agentic-runtime-binding-context';
import type { SkillRuntimeManifest } from '../../../shared/agent-runtime-v5/contracts';
import { resolveRuntimeStagePlanEffectiveContract } from '../../../shared/agent-runtime-v5/runtime-stage-plan';
import {
    buildRuntimeContractBundleForAgentTask,
    type AgentTaskRuntimeContractBundle
} from '../../../shared/agent-runtime-v5/runtime-contract-bundle';
import {
    resolveRuntimeDeclarationForAgentTask,
    type RuntimeDeclarationRepairCode,
    type RuntimeDeclarationResolution
} from '../../../shared/agent-runtime-v5/runtime-declaration-resolver';
import {
    buildRuntimeContractStatus,
    validateRuntimeSelectedSkillHandoff,
    type RuntimeContractStatus,
    type RuntimeSelectedSkillHandoff
} from '../../../shared/agent-runtime-v5/runtime-selected-skill-handoff';
import {
    advanceRuntimeSessionGeneration,
    advanceRuntimeSessionIdentity,
    bindRuntimeSessionIdentity,
    createRuntimeSessionIdentity,
    type RuntimeSession,
    type RuntimeSessionIdentity
} from '../../../shared/agent-runtime-v5/runtime-session';
import {
    buildRuntimePlanningContextSeed,
    type RuntimePlanningContextSeed
} from '../../../shared/agent-runtime-v5/runtime-planning-context-seed';
import {
    projectRuntimeInteractiveWorkflowResult,
    shouldDeferRuntimeArtifactFinalizationForInteraction,
    validateRuntimeInteractiveReentry,
    type RuntimeInteractiveReentry
} from '../../../shared/agent-runtime-v5/runtime-interactive-reentry';
import type { RuntimePerformanceUsage } from '../../../shared/agent-runtime-v5/runtime-accounting';
import { readRuntimeTaskSnapshot } from '../../../shared/agent-runtime-v5/runtime-task-snapshot';
import {
    readArtifactRepositoryProjection,
    type ArtifactRepositoryReadProjection
} from '../../../shared/agent-runtime-v5/artifact-repository-contract';
import {
    RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
    RUNTIME_ARTIFACT_FINALIZATION_VERSION,
    RUNTIME_SESSION_IDENTITY_ISSUANCE_REQUEST_VERSION,
    readRuntimeArtifactAuthorizationGrant,
    readRuntimeSessionIdentityIssuanceGrant,
    type RuntimeArtifactAuthorizationGrant,
    type RuntimeArtifactFinalizationRequest,
    type RuntimeSessionIdentityIssuanceGrant
} from '../../../shared/agent-runtime-v5/runtime-artifact-finalization';
import {
    buildGenerationScopedDataContextItems,
    canReenterAfterGenerationProjectStateRefresh,
    compileRuntimeContext,
    hasSuccessfulGenerationProjectStateUpdate,
    readLatestOwnerConfirmedGenerationProjectState,
    type RuntimeContextItem,
    type RuntimeContextSnapshotStatus
} from '../../../shared/agent-runtime-v5/runtime-context-compiler';
import {
    buildAgentConversationHistoryRuntimeItem,
    selectAgentConversationContext
} from '../../../shared/agent-conversation-context';
import { buildAgentContextCapacityPlan } from '../../../shared/agent-context-allocation';
import { resolveModelContextWindow } from '../../../shared/config/models.config';
import { buildAgentOperatingProfilePromptSection } from '../../../shared/agent-runtime-v5/agent-operating-profile';
import type { RuntimeDesignBriefAvailableInputSource } from '../../../shared/agent-runtime-v5/runtime-design-brief-declaration';
import { projectRuntimeReferencePolicy } from '../../../shared/agent-runtime-v5/runtime-reference-context';
import {
    OPERATING_CONTEXT_RUNTIME_ITEM_ID,
    buildOperatingContextRuntimeItem,
    resolveOperatingPhotoshopConnection
} from '../../../shared/agent-runtime-v5/operating-context-snapshot';
import {
    buildDesignMethodKnowledgeRuntimeContext
} from '../../../shared/agent-runtime-v5/design-method-knowledge';
import { buildDesignPrinciplesSummary } from '../../../shared/knowledge/design-principles';
import {
    readRuntimePlanningDeclarationsFromAgentResult,
    registerRuntimeInteractiveCheckpointFromAgentResult
} from '../agent-runtime/runtime-interactive-checkpoint-adapter';
import { buildDesignArtifactKnowledgeRuntimeItem } from '../../../shared/knowledge/design-artifact-knowledge';
import { buildPhotoshopCraftRecipeRuntimeItems } from '../../../shared/knowledge/photoshop-craft-recipes';
import { getTaskContextBuilder, type RuntimeTaskContextApi } from '../design-intelligence/task-context-builder-factory';
import {
    buildMultimodalModelDispatchPlan,
    formatPrimaryAgentDispatchPromptSection
} from '../../../shared/multimodal-model-dispatch';
import {
    buildAgentUnboundAutonomousPerformancePolicy,
    buildAgentPerformancePolicy,
    buildAutonomousAgentRuntimeBudget,
    resolveDeclaredRuntimeMaxIterations,
    type AgentPerformancePolicy,
    type DesignTeamChildExecutionReservation
} from '../../../shared/agent-performance-policy';
import { evaluateScopedEditExecutionScope } from '../../../shared/agent-runtime-v5/scoped-edit-runtime-policy';
import {
    buildAgentIntentControlPlaneDecision,
    type AgentIntentControlPlaneDecision
} from '../../../shared/agent-intent-control-plane';
import type { DesignAgentOsScenario } from '../../../shared/design-agent-os-contracts';
import { buildDesignerAgentDecisionContract } from '../../../shared/designer-agent-decision-contract';
import {
    buildDesignerAgentAutonomyPrinciplesPromptSection,
    buildDesignerDecisionOwnershipPromptSection
} from '../../../shared/designer-agent-autonomy-principles';
import {
    buildDesignerAgentTeamConsultationContract,
    buildDesignerAgentTeamConsultationProgress
} from '../../../shared/designer-agent-team-consultation-contract';
import {
    buildDesignDocumentRoleContext,
    evaluateCreateDocumentTargetBoundary,
    extractUserExplicitDocumentOverrides,
    isCreateDocumentOperation,
    normalizeCreateDocumentParamsForDesignRole,
    normalizeLayoutParamsForDesignRole,
    type UserExplicitDocumentOverrides
} from '../../../shared/design-document-role';
import {
    normalizeDesignDimensionSpec,
    summarizeDesignDimensionSpecForAgent,
    type DesignDimensionSpec
} from '../../../shared/design-dimension-spec';
function requiresDesignRunDelivery(
    workMode: ReturnType<typeof normalizeRuntimeDesignWorkMode>
): boolean {
    return workMode !== 'edit_existing' && workMode !== 'analyze_only';
}

function resolveManifestReasoningEffort(manifest?: {
    required_model_profiles?: readonly string[];
}): ModelReasoningEffort | undefined {
    const profiles = new Set(manifest?.required_model_profiles || []);
    if (profiles.has('reasoning.quality')) return 'high';
    if (profiles.has('reasoning.balanced')) return 'medium';
    if (profiles.has('reasoning.fast')) return 'low';
    return undefined;
}

function projectManifestReasoningEffort(manifest?: {
    required_model_profiles?: readonly string[];
}): { reasoningEffort?: ModelReasoningEffort } {
    const reasoningEffort = resolveManifestReasoningEffort(manifest);
    return reasoningEffort ? { reasoningEffort } : {};
}

function withDesignKnowledgeNativeTools(
    modelId: string,
    options?: Record<string, any>,
    requestWebSearchIntent?: ChatWebSearchIntent
): Record<string, any> | undefined {
    const model = getModelById(modelId);
    if (!model) return options;

    const state = useAppStore.getState();
    const hasExplicitNativeTools = Array.isArray(options?.nativeTools) && options.nativeTools.length > 0;
    if (hasExplicitNativeTools) return options;
    if (!requestWebSearchIntent) return options;

    const requestedWebSearch = toProviderNativeWebSearchIntent(requestWebSearchIntent, state.designKnowledgeSettings);
    if (!requestedWebSearch) return options;

    const providerNativeWebSearch = buildProviderNativeToolPlan({
        provider: model.provider,
        modelId: model.apiModelId || model.id,
        requestedTools: [requestedWebSearch]
    });

    if (providerNativeWebSearch.status !== 'ready') {
        return options;
    }

    return {
        ...options,
        nativeTools: providerNativeWebSearch.nativeTools
    };
}

type WebSearchVisibilityState = {
    intent?: ChatWebSearchIntent;
    callbacks?: AgentCallbacks;
    started: boolean;
    completed: boolean;
};

const WEB_SEARCH_TOOL_CALL_ID = 'provider-native-web-search';

function hasProviderNativeWebSearch(options?: Record<string, any>): boolean {
    return Array.isArray(options?.nativeTools)
        && options.nativeTools.some((tool: any) => tool?.type === 'web_search');
}

function emitProviderNativeWebSearchStarted(state?: WebSearchVisibilityState) {
    if (!state?.intent || state.started) return;
    state.started = true;
    state.callbacks?.onStep?.({
        kind: 'tool_started',
        title: '联网搜索',
        detail: formatChatWebSearchVisibleStep(state.intent),
        status: 'running',
        toolName: 'providerNativeWebSearch',
        toolCallId: WEB_SEARCH_TOOL_CALL_ID
    });
}

function emitProviderNativeWebSearchCompleted(state?: WebSearchVisibilityState, response?: any) {
    if (!state?.intent || !state.started || state.completed) return;
    state.completed = true;
    const citationCount = Array.isArray(response?.citations) ? response.citations.length : 0;
    state.callbacks?.onStep?.({
        kind: 'tool_completed',
        title: '联网搜索完成',
        detail: formatChatWebSearchCompletedStep(state.intent, { citationCount }),
        status: 'success',
        toolName: 'providerNativeWebSearch',
        toolCallId: WEB_SEARCH_TOOL_CALL_ID
    });
}

function emitProviderNativeWebSearchFailed(state?: WebSearchVisibilityState) {
    if (!state?.intent || !state.started || state.completed) return;
    state.completed = true;
    state.callbacks?.onStep?.({
        kind: 'tool_completed',
        title: '联网搜索未完成',
        detail: `${formatChatWebSearchVisibleStep(state.intent)}（未完成）`,
        status: 'error',
        toolName: 'providerNativeWebSearch',
        toolCallId: WEB_SEARCH_TOOL_CALL_ID
    });
}

function toPlainModelMessages(messages: Parameters<CallModelFn>[1]): Array<Record<string, unknown>> {
    return messages.map((message) => {
        let content: unknown = String(message.content || '');
        if (Array.isArray(message.contentBlocks) && message.contentBlocks.length > 0) {
            content = message.contentBlocks.map((block) => {
                if (block.type === 'image') {
                    return {
                        type: 'image',
                        image: { data: block.data || '', mediaType: block.mediaType || 'image/png' }
                    };
                }
                return { type: 'text', text: block.text || '' };
            });
        }
        return { role: message.role, content };
    });
}

const AUTONOMOUS_MODEL_TRANSPORT_MAX_ATTEMPTS = 2;
const AUTONOMOUS_MODEL_TRANSPORT_RETRY_DELAY_MS = 400;
const AGENT_INTERNAL_PROVIDER_TOOL_NAMES = new Set(['smartSave']);

type ModelErrorWithTransportAttempts = Error & {
    transportAttempts?: ModelTransportAttemptAccounting[];
};

function buildModelTransportAttempt(
    startedAtMs: number,
    succeeded: boolean,
    usage?: ModelTransportAttemptAccounting['usage'],
    failure?: ModelProviderFailure,
    visualPresentationReceipt?: unknown,
    providerTransportMetrics?: unknown
): ModelTransportAttemptAccounting {
    const providerCode = String(failure?.providerCode || '').trim().slice(0, 120);
    const numericStatus = Number(failure?.status);
    const status = Number.isInteger(numericStatus)
        && numericStatus >= 100
        && numericStatus <= 599
        ? numericStatus
        : undefined;
    const receiptRef = projectModelVisualPresentationReceiptRef({
        succeeded,
        receipt: visualPresentationReceipt
    });
    const transportMetrics = succeeded
        ? readProviderTransportMetrics(providerTransportMetrics)
        : undefined;
    return {
        durationMs: Math.max(0, Math.floor(Date.now() - startedAtMs)),
        succeeded,
        ...(usage ? { usage } : {}),
        ...(!succeeded && failure ? {
            failureKind: failure.kind,
            ...(providerCode ? { providerCode } : {}),
            ...(status ? { status } : {})
        } : {}),
        ...(transportMetrics ? { providerTransportMetrics: transportMetrics } : {}),
        ...(receiptRef ? { visualPresentationReceiptRef: receiptRef } : {})
    };
}

function attachModelTransportAttempts(
    error: Error,
    attempts: ModelTransportAttemptAccounting[]
): Error {
    (error as ModelErrorWithTransportAttempts).transportAttempts = attempts.slice();
    return error;
}

function isRetryableAutonomousModelCallError(input: {
    error: Error;
    attempt: number;
    hasEmittedStreamPayload: boolean;
}): input is {
    error: ModelProviderCallError;
    attempt: number;
    hasEmittedStreamPayload: boolean;
} {
    const { error } = input;
    if (!(error instanceof ModelProviderCallError)) return false;
    return shouldRetryAutonomousModelTransport({
        failure: error.providerFailure,
        attempt: input.attempt,
        maxAttempts: AUTONOMOUS_MODEL_TRANSPORT_MAX_ATTEMPTS,
        hasEmittedStreamPayload: input.hasEmittedStreamPayload
    });
}

function waitForAutonomousModelTransportRetry(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, AUTONOMOUS_MODEL_TRANSPORT_RETRY_DELAY_MS);
    });
}

interface AutonomousAgentRuntimeActivity {
    modelCallsStarted: number;
    modelResponsesCompleted: number;
    iterationsCompleted: number;
    startedToolNames: string[];
    completedToolCalls: AgentToolCallLogEntry[];
}

function wrapAutonomousAgentModelCallError(modelId: string, error: unknown): Error {
    if (error instanceof ModelProviderCallError) return error;
    const providerFailure = classifyModelProviderFailure(error);
    // Renderer 的模型 IPC 边界还可能承载本地 capability、schema、序列化或 UI 回调错误。
    // 只有能确定归因的 Provider 失败才打 Provider 标签；unknown 保留原错误走 Runtime 分支。
    if (providerFailure.kind === 'unknown') {
        return error instanceof Error
            ? error
            : new Error(String(error || 'unknown_model_call_boundary_failure'));
    }
    return new ModelProviderCallError(modelId, providerFailure);
}

function createAutonomousAgentRuntimeActivity(): AutonomousAgentRuntimeActivity {
    return {
        modelCallsStarted: 0,
        modelResponsesCompleted: 0,
        iterationsCompleted: 0,
        startedToolNames: [],
        completedToolCalls: []
    };
}

function createCallModelViaIPC(
    requestWebSearchIntent?: ChatWebSearchIntent,
    webSearchVisibility?: WebSearchVisibilityState,
    runtimeActivity?: AutonomousAgentRuntimeActivity
): CallModelFn {
    return async (modelId, messages, tools, options) => {
        const modelOptions = withDesignKnowledgeNativeTools(modelId, options, requestWebSearchIntent);
        const debugTransportMetadata = resolveDebugProjectReferenceTransportMetadata(messages);
        const hasWebSearch = hasProviderNativeWebSearch(modelOptions);
        const hasProviderNativeTools = Array.isArray(modelOptions?.nativeTools)
            && modelOptions.nativeTools.length > 0;
        const transport = resolveAgentModelTransport({
            messages,
            toolCount: tools.length,
            hasProviderNativeTools
        });
        if (hasWebSearch) emitProviderNativeWebSearchStarted(webSearchVisibility);
        let response: any;
        const transportAttempts: ModelTransportAttemptAccounting[] = [];
        for (let attempt = 1; attempt <= AUTONOMOUS_MODEL_TRANSPORT_MAX_ATTEMPTS; attempt += 1) {
            if (runtimeActivity) runtimeActivity.modelCallsStarted += 1;
            const attemptStartedAtMs = Date.now();
            try {
                // 纯视觉观察/质量判定没有工具 schema，不应强迫视觉模型支持 function calling。
                // 但已经进入工具 / reasoning 协议的历史必须继续经 provider adapter 合法序列化。
                if (transport === 'plain_chat') {
                    const plainResponse = await (window as any).designEcho.chat(
                        modelId,
                        toPlainModelMessages(messages),
                        modelOptions,
                        debugTransportMetadata
                    );
                    response = {
                        content: String(plainResponse?.text || ''),
                        thinking: plainResponse?.thinking,
                        usage: plainResponse?.usage,
                        stopReason: 'end_turn',
                        visualPresentationReceipt: plainResponse?.visualPresentationReceipt
                    };
                } else {
                    response = await (window as any).designEcho.chatWithTools(
                        modelId,
                        messages,
                        tools,
                        modelOptions,
                        debugTransportMetadata
                    );
                }
                transportAttempts.push(buildModelTransportAttempt(
                    attemptStartedAtMs,
                    true,
                    response?.usage,
                    undefined,
                    response?.visualPresentationReceipt,
                    response?.providerTransportMetrics
                ));
                break;
            } catch (error) {
                const wrappedError = wrapAutonomousAgentModelCallError(modelId, error);
                const attemptFailure = wrappedError instanceof ModelProviderCallError
                    ? wrappedError.providerFailure
                    : classifyModelProviderFailure(wrappedError);
                transportAttempts.push(buildModelTransportAttempt(
                    attemptStartedAtMs,
                    false,
                    undefined,
                    attemptFailure
                ));
                const canRetry = isRetryableAutonomousModelCallError({
                    error: wrappedError,
                    attempt,
                    hasEmittedStreamPayload: false
                });
                if (canRetry) {
                    await waitForAutonomousModelTransportRetry();
                    continue;
                }
                if (hasWebSearch) emitProviderNativeWebSearchFailed(webSearchVisibility);
                throw attachModelTransportAttempts(wrappedError, transportAttempts);
            }
        }
        if (runtimeActivity) runtimeActivity.modelResponsesCompleted += 1;
        // UI 可见性回调不属于 Provider 请求边界，不能被重新标记为 Provider 错误。
        if (hasWebSearch) emitProviderNativeWebSearchCompleted(webSearchVisibility, response);
        return {
            ...response,
            transportAttempts
        };
    };
}

function createAutonomousModelStreamAbortError(): Error & { code: string } {
    const error = new Error('Agent 模型请求已取消') as Error & { code: string };
    error.name = 'AbortError';
    error.code = 'stream_aborted';
    return error;
}

function createCallModelStreamViaIPC(
    requestWebSearchIntent?: ChatWebSearchIntent,
    webSearchVisibility?: WebSearchVisibilityState,
    runtimeActivity?: AutonomousAgentRuntimeActivity,
    runSignal?: AbortSignal
): CallModelStreamFn {
    return async (modelId, messages, tools, options) => {
        const {
            onContentDelta,
            onThinkingDelta,
            onToolCallDelta,
            onToolCallReady,
            ...modelOptions
        } = options || {};

        let hasEmittedStreamPayload = false;
        const trackedOnContentDelta = onContentDelta
            ? (fullContent: string, delta: string): void => {
                if (fullContent || delta) hasEmittedStreamPayload = true;
                onContentDelta(fullContent, delta);
            }
            : undefined;
        const trackedOnThinkingDelta = onThinkingDelta
            ? (fullThinking: string, delta: string): void => {
                if (fullThinking || delta) hasEmittedStreamPayload = true;
                onThinkingDelta(fullThinking, delta);
            }
            : undefined;
        const trackedOnToolCallDelta = onToolCallDelta
            ? (chunk: Parameters<NonNullable<typeof onToolCallDelta>>[0]): void => {
                hasEmittedStreamPayload = true;
                onToolCallDelta(chunk);
            }
            : undefined;
        const trackedOnToolCallReady = onToolCallReady
            ? (toolCall: Parameters<NonNullable<typeof onToolCallReady>>[0]): void => {
                hasEmittedStreamPayload = true;
                onToolCallReady(toolCall);
            }
            : undefined;

        const optionsWithNativeTools = withDesignKnowledgeNativeTools(modelId, {
            ...modelOptions,
            onContentDelta: trackedOnContentDelta,
            onThinkingDelta: trackedOnThinkingDelta,
            onToolCallDelta: trackedOnToolCallDelta,
            onToolCallReady: trackedOnToolCallReady
        }, requestWebSearchIntent);
        const debugTransportMetadata = resolveDebugProjectReferenceTransportMetadata(messages);
        const hasWebSearch = hasProviderNativeWebSearch(optionsWithNativeTools);
        if (hasWebSearch) emitProviderNativeWebSearchStarted(webSearchVisibility);

        let response: any;
        const transportAttempts: ModelTransportAttemptAccounting[] = [];
        for (let attempt = 1; attempt <= AUTONOMOUS_MODEL_TRANSPORT_MAX_ATTEMPTS; attempt += 1) {
            if (runtimeActivity) runtimeActivity.modelCallsStarted += 1;
            const attemptStartedAtMs = Date.now();
            try {
                response = await streamChatWithToolsAsync(
                    modelId,
                    messages,
                    tools,
                    {
                        ...optionsWithNativeTools,
                        signal: runSignal
                    },
                    debugTransportMetadata
                );
                if (runSignal?.aborted) throw createAutonomousModelStreamAbortError();
                transportAttempts.push(buildModelTransportAttempt(
                    attemptStartedAtMs,
                    true,
                    response?.usage,
                    undefined,
                    response?.visualPresentationReceipt,
                    response?.providerTransportMetrics
                ));
                break;
            } catch (error) {
                const wrappedError = wrapAutonomousAgentModelCallError(modelId, error);
                const attemptFailure = wrappedError instanceof ModelProviderCallError
                    ? wrappedError.providerFailure
                    : classifyModelProviderFailure(wrappedError);
                transportAttempts.push(buildModelTransportAttempt(
                    attemptStartedAtMs,
                    false,
                    undefined,
                    attemptFailure
                ));
                if (runSignal?.aborted) {
                    throw attachModelTransportAttempts(wrappedError, transportAttempts);
                }
                const canRetry = isRetryableAutonomousModelCallError({
                    error: wrappedError,
                    attempt,
                    hasEmittedStreamPayload
                });
                if (canRetry) {
                    await waitForAutonomousModelTransportRetry();
                    continue;
                }
                if (hasWebSearch) emitProviderNativeWebSearchFailed(webSearchVisibility);
                throw attachModelTransportAttempts(wrappedError, transportAttempts);
            }
        }
        if (runtimeActivity) runtimeActivity.modelResponsesCompleted += 1;
        if (hasWebSearch) emitProviderNativeWebSearchCompleted(webSearchVisibility, response);
        return {
            ...response,
            transportAttempts
        };
    };
}

const callModelViaIPC: CallModelFn = createCallModelViaIPC();
const callModelStreamViaIPC: CallModelStreamFn = createCallModelStreamViaIPC();


// 委派安全纵深（治理审计 2026-07-08 既有盲区收口）：DesignTeamCoordinator 给设计队友子代理用的是
// 原始 executeToolCall，绕过主循环 createExecuteToolWrapper 的破坏性动作 hook / HITL 卡 / 外部内容
// 信任标记。当前队友工具集经 registry curation 不含任何安全策略拦截的工具（closeDocument/
// interactWithBrowserPage），故此绕过当前不可达。本 wrapper 补三层：
//  (1) 破坏性动作确定性硬拦：委派语境无人类确认通道，命中即硬拦并要求升级回主 Agent（忽略模型自带确认
//      参数，红线A）。防未来给某队友加入破坏性工具、或模型幻觉出未暴露的破坏性工具（executeToolCall 按
//      全局注册表执行、不做每-agent 允许集的执行层强制）。非破坏性工具零影响 → 当前零行为改变。
//  (2) markExternalContentTrust：与主 wrapper 对齐，给队友的外部内容工具结果（如 searchEagleReferences）
//      打 untrusted 标记，防间接提示注入经队友传导到下游。
//  (3) 用户显式拒绝的 provider Tool / Photoshop 域在队友最终执行点再次硬拦，不能靠委派恢复。
// 边界（对抗核验 F1）：本硬拦只守在【顶层工具派发边界】，看不到复合工具内部对 gated 工具的嵌套裸调用；
// 新增这类调用点时必须显式复核其所属复合工具是否也应从队友能力面移除。
type ProviderToolDenyEvaluator = (toolName: string, params: any) => Record<string, any> | null;

function createExecuteToolForTeammate(
    denyProviderTool?: ProviderToolDenyEvaluator,
    baseExecutionOptions: ToolCallExecutionOptions = {}
): (toolName: string, params: any) => Promise<any> {
    return async function executeToolForTeammate(toolName: string, params: any): Promise<any> {
        const capabilityBlock = denyProviderTool?.(toolName, params);
        if (capabilityBlock) return capabilityBlock;
        const delegatedBlock = evaluateDelegatedToolSafetyBlock(toolName, params);
        if (delegatedBlock) {
            return {
                success: false,
                policyGate: true,
                safetyBlock: true,
                delegatedDestructiveBlocked: true,
                error: delegatedBlock.message
            };
        }
        return markExternalContentTrust(toolName, await executeToolCall(toolName, params, {
            ...baseExecutionOptions,
            visualConsumptionOwner: 'calling_agent'
        }));
    };
}

function createDesignTeamCoordinator(
    denyProviderTool?: ProviderToolDenyEvaluator,
    baseExecutionOptions: ToolCallExecutionOptions = {}
): DesignTeamCoordinator {
    return new DesignTeamCoordinator({
        callModel: callModelViaIPC,
        executeTool: createExecuteToolForTeammate(denyProviderTool, baseExecutionOptions),
        resolveDefaultModelId: () => getModelId('logic')
    });
}

const designTeamCoordinator = createDesignTeamCoordinator();

async function executeDelegateToAgent(
    params: {
        role: DesignTeammateRole;
        task: string;
        context?: string;
    },
    callbacks?: AgentCallbacks,
    signal?: AbortSignal,
    workspace?: DesignTeamWorkspace,
    projectPath?: string,
    coordinator: DesignTeamCoordinator = designTeamCoordinator,
    childAllowance?: DesignTeamChildExecutionAllowance
): Promise<any> {
    const { role, task, context: taskContext } = params;

    if (!role) {
        return { success: false, error: 'Missing teammate role' };
    }

    emitTeammateActivityStep(callbacks, role, 'started');

    const result = await coordinator.runTeammateTask(
        {
            role,
            task,
            context: taskContext
        },
        {
            onToolStart: (name) => console.log(`[DesignTeammate:${role}] ${name}`)
        },
        signal,
        // 同一次运行内共享团队工作区：后续委派自动看到前序队友成果；
        // 提供 projectPath 时产出写穿到 Design Project State
        {
            workspace,
            projectPath,
            ...(childAllowance ? {
                stageMaxIterations: childAllowance.maxModelCalls,
                stagePerformanceBudget: {
                    maxModelCalls: childAllowance.maxModelCalls,
                    maxToolCalls: childAllowance.maxToolCalls,
                    maxVisionCandidates: childAllowance.maxVisionCandidates,
                    maxInitialVisionCandidates: 0,
                    maxVisualAnalyses: childAllowance.maxVisualAnalyses,
                    maxFullResolutionImageReads: 0,
                    softTimeBudgetMs: Math.max(1, childAllowance.deadlineAtMs - Date.now()),
                    ...(childAllowance.maxPrimaryOutputTokens
                        ? { maxPrimaryOutputTokens: childAllowance.maxPrimaryOutputTokens }
                        : {}),
                    ...(typeof childAllowance.allowProviderThinking === 'boolean'
                        ? { allowProviderThinking: childAllowance.allowProviderThinking }
                        : {})
                }
            } : {})
        }
    );

    emitTeammateActivityStep(callbacks, role, result.success ? 'completed' : 'failed', result.error);

    return result;
}

function compactDesignTeamContextText(value: unknown, maxLength: number): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function compactDesignTeamContextList(
    value: unknown,
    maxItems: number,
    maxItemLength: number
): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .slice(0, maxItems)
        .map((item) => compactDesignTeamContextText(item, maxItemLength))
        .filter(Boolean)));
}

/**
 * 把当前 Agent 已校验的 Brief / Strategy 与 Manifest-selected Profile 投影给全部队友。
 * 这里只编译有界只读上下文，不建立第二 Context owner；模型工具参数里的补充 context 单独降权。
 */
function buildDesignTeamGlobalEvaluationContext(
    runtimeContext: ExecuteToolRuntimeContext | undefined,
    supplementalContext: unknown
): string {
    const briefDigest = runtimeContext?.runtimeDesignBriefDigest;
    const briefDeclaration = runtimeContext?.runtimeDesignBriefDeclaration;
    const briefPayload = briefDeclaration?.payload;
    const strategyDigest = runtimeContext?.runtimeDesignStrategyDigest;
    const strategyDeclaration = runtimeContext?.runtimeDesignStrategyDeclaration;
    const strategyPayload = strategyDeclaration?.payload;
    const evaluationProfile = runtimeContext?.runtimeEvaluationProfile;
    const vlmAssertions = evaluationProfile
        ? getDesignEvaluationProfileVlmAssertions(evaluationProfile)
        : [];
    const projection = {
        version: 'design-team-global-evaluation-context/v0',
        trust: 'harness_validated_read_only_context',
        priority: 'user_task_then_brief_then_evaluation_profile_then_team_plan',
        brief: briefDigest || briefDeclaration ? {
            readiness: briefDigest?.readiness || briefDeclaration?.readiness,
            workMode: briefDigest?.workMode || briefPayload?.workMode,
            taskGoal: compactDesignTeamContextText(
                briefDigest?.taskGoal || briefPayload?.taskGoal,
                480
            ),
            deliverables: compactDesignTeamContextList(
                briefDigest?.deliverables || briefPayload?.deliverables,
                16,
                160
            ),
            targetAudience: compactDesignTeamContextText(briefPayload?.targetAudience, 240),
            channel: compactDesignTeamContextText(briefPayload?.channel, 120),
            outputRequirements: compactDesignTeamContextList(
                briefPayload?.outputRequirements,
                16,
                180
            ),
            constraints: compactDesignTeamContextList(briefPayload?.constraints, 16, 180),
            missingRequiredInputKeys: compactDesignTeamContextList(
                briefDigest?.missingRequiredInputKeys,
                16,
                80
            ),
            assumedRequiredInputKeys: compactDesignTeamContextList(
                briefDigest?.assumedRequiredInputKeys,
                16,
                80
            )
        } : undefined,
        strategy: strategyDigest || strategyDeclaration ? {
            readiness: strategyDigest?.readiness || strategyDeclaration?.readiness,
            primaryGoal: compactDesignTeamContextText(strategyDigest?.primaryGoal, 320),
            targetAudienceSummary: compactDesignTeamContextText(
                strategyDigest?.targetAudienceSummary,
                320
            ),
            primaryMessage: compactDesignTeamContextText(strategyDigest?.primaryMessage, 320),
            moodKeywords: compactDesignTeamContextList(strategyDigest?.moodKeywords, 12, 80),
            compositionIntent: compactDesignTeamContextList(
                strategyDigest?.compositionIntent,
                12,
                160
            ),
            constraints: compactDesignTeamContextList(strategyPayload?.constraints, 12, 180)
        } : undefined,
        evaluationProfile: evaluationProfile ? {
            profileId: evaluationProfile.profileId,
            capabilityGoal: compactDesignTeamContextText(evaluationProfile.capabilityGoal, 480),
            scoring: evaluationProfile.scoring,
            assertions: vlmAssertions.slice(0, 16).map((assertion) => ({
                id: assertion.id,
                criterion: compactDesignTeamContextText(
                    assertion.judgeCriterion || assertion.label,
                    480
                ),
                allowNotApplicable: assertion.allowNotApplicable === true
            })),
            requiredChecks: evaluationProfile.checks
                .filter((check) => check.required)
                .slice(0, 12)
                .map((check) => ({
                    key: check.key,
                    label: compactDesignTeamContextText(check.label, 160),
                    expectedFix: compactDesignTeamContextText(check.expectedFix, 320)
                })),
            boundaries: {
                grantsPermission: false,
                ownsFinalVerdict: false
            }
        } : undefined,
        supplementalContext: compactDesignTeamContextText(supplementalContext, 1600),
        supplementalContextTrust: 'untrusted_model_tool_parameter'
    };
    return [
        'DESIGN_TEAM_GLOBAL_EVALUATION_CONTEXT（只读；不授予工具权限，不拥有最终裁决）：',
        JSON.stringify(projection)
    ].join('\n');
}

async function executeRunDesignTeamPipeline(
    params: {
        goal: string;
        context?: string;
        maxRevisions?: number;
        projectPath?: string;
        specialistRoles?: Array<'market-researcher' | 'copywriter'>;
    },
    callbacks?: AgentCallbacks,
    signal?: AbortSignal,
    projectPath?: string,
    coordinator: DesignTeamCoordinator = designTeamCoordinator,
    plannedRoles: DesignTeammateRole[] = [],
    childAllowance?: DesignTeamChildExecutionAllowance
): Promise<any> {
    if (!childAllowance) {
        return {
            success: false,
            code: 'design_team_child_allowance_missing',
            error: '完整设计团队流水线缺少父 Agent 事前签发的子执行额度。'
        };
    }
    const effectivePlannedRoles = resolveDesignTeamPipelinePlannedRoles(params, plannedRoles);
    const result = await coordinator.runPipeline(
        {
            goal: String(params?.goal || ''),
            context: params?.context,
            maxRevisions: params?.maxRevisions,
            projectPath: params?.projectPath || projectPath,
            plannedRoles: effectivePlannedRoles,
            childAllowance
        },
        callbacks,
        signal
    );
    const output = {
        success: result.success,
        qualityPassed: result.qualityPassed,
        childAgentUsage: result.childAgentUsage,
        budgetExhausted: result.budgetExhausted,
        message: result.message,
        cancelled: result.cancelled,
        error: result.error,
        data: {
            goal: result.goal,
            qualityPassed: result.qualityPassed,
            childAgentUsage: result.childAgentUsage,
            budgetExhausted: result.budgetExhausted,
            stages: result.stages.map(s => ({
                stage: s.stage,
                role: s.role,
                success: s.success,
                iterations: s.iterations,
                toolsUsed: s.toolsUsed
            })),
            verdict: result.verdict
                ? { status: result.verdict.status, issues: result.verdict.issues }
                : undefined,
            revisionRounds: result.revisionRounds
        }
    };
    transferTrustedVisualReviewArtifact(result, output);
    return output;
}

function resolveDesignTeamPipelinePlannedRoles(
    params: { specialistRoles?: Array<'market-researcher' | 'copywriter'> },
    plannedRoles: readonly DesignTeammateRole[] = []
): DesignTeammateRole[] {
    const requestedSpecialistRoles = Array.isArray(params?.specialistRoles)
        ? params.specialistRoles.filter((role) => (
            role === 'market-researcher' || role === 'copywriter'
        ))
        : [];
    return Array.from(new Set([
        ...(plannedRoles || []),
        ...requestedSpecialistRoles
    ]));
}

function emitTeammateActivityStep(
    callbacks: AgentCallbacks | undefined,
    role: DesignTeammateRole,
    phase: 'started' | 'completed' | 'failed',
    error?: string
): void {
    const definition = getDesignTeammateDefinition(role);
    const label = definition?.displayName || role || 'Design Teammate';
    let titlePrefix = '子 Agent 失败';
    let status: 'running' | 'success' | 'error' = 'error';
    let kind: 'tool_started' | 'tool_completed' = 'tool_completed';

    if (phase === 'started') {
        titlePrefix = '开始子 Agent';
        status = 'running';
        kind = 'tool_started';
    } else if (phase === 'completed') {
        titlePrefix = '子 Agent 完成';
        status = 'success';
    }

    callbacks?.onStep?.({
        kind,
        title: `${titlePrefix}：${label}`,
        detail: error ? `子 Agent role: ${role}\n${error}` : `子 Agent role: ${role}`,
        status,
        toolName: `delegateToAgent:${role}`,
        toolCallId: `delegate-${role}`
    });
}

function readResultRecord(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, any>;
}

/**
 * 设计纪律的「视觉复核证据」判定（单一事实源，三处共用）：
 * 1. 截图被主模型/视觉专家真实复核（reviewed === true）→ 是；
 * 2. 视觉复核在运行层确实不可用（无视觉能力 / 视觉预算耗尽 / 专家失败），
 *    且本次成功调用了结构复核工具（图层/文本/蒙版/布局读回等）→ 是。
 *
 * 第二支路的理由：纪律要求「改后必看」是为了防止不回头看就继续写/导出；
 * 当系统确定性地无法提供视觉复核时（能力缺失或预算耗尽并已如实告知模型），
 * 结构化读回是模型唯一可用的复核手段，不应把写入/导出永久锁死
 * （2026-08-04 治理：预算×纪律互锁缺陷修复，见 docs/agent-gates-definitions.md 4.1）。
 */
function resolveVisualReviewedForDiscipline(
    result: any,
    toolName: string
): boolean {
    const observation = readAgentVisualObservation(result);
    if (observation?.reviewed === true) return true;
    return isRuntimeVisualReviewBlocked(observation)
        && isStructuralDesignReviewTool(toolName)
        && result?.success !== false;
}

function readPrivateTargetGuard(value: unknown): AgentToolExecutionTargetGuard | undefined {
    const record = readResultRecord(value);
    const expectedDocumentId = record.expectedDocumentId;
    const expectedActiveLayerId = record.expectedActiveLayerId;
    const expectedHistoryStateRef = readPhotoshopHistoryStateRef({
        historyStateRef: record.expectedHistoryStateRef
    });
    const observationTool = String(record.observationTool || '').trim();
    if (!Number.isSafeInteger(expectedDocumentId) || expectedDocumentId <= 0 || !observationTool) {
        return undefined;
    }
    if (expectedActiveLayerId !== undefined
        && (!Number.isSafeInteger(expectedActiveLayerId) || expectedActiveLayerId <= 0)) {
        return undefined;
    }
    if (record.expectedHistoryStateRef !== undefined
        && (!expectedHistoryStateRef || expectedHistoryStateRef.documentId !== expectedDocumentId)) {
        return undefined;
    }
    return {
        expectedDocumentId,
        ...(expectedActiveLayerId !== undefined ? { expectedActiveLayerId } : {}),
        ...(expectedHistoryStateRef ? { expectedHistoryStateRef } : {}),
        observationTool
    };
}

function stripPrivateTargetGuard(params: Record<string, any>): Record<string, any> {
    const {
        [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: _privateTargetGuard,
        ...businessParams
    } = params || {};
    return businessParams;
}

function stripCreateDocumentPseudoConfirmation(params: Record<string, any>): Record<string, any> {
    const {
        confirmNewDocumentDespiteExisting: _modelAuthoredConfirmation,
        ...documentParams
    } = params || {};
    return documentParams;
}

function countSuccessfulMutationCalls(result: {
    executionSummary?: { successfulMutationCalls?: number };
    toolCallLog?: AgentToolCallLogEntry[];
}): number {
    const summaryCount = Number(result.executionSummary?.successfulMutationCalls);
    const observedSummaryCount = Number.isSafeInteger(summaryCount) && summaryCount >= 0
        ? summaryCount
        : 0;
    const logCount = (result.toolCallLog || []).filter((entry) => {
        if (entry.result?.success === false) return false;
        const kind = classifyAgentToolExecution(entry.name, entry.arguments);
        return kind === 'photoshop_write' || kind === 'save_export';
    }).length;
    return Math.max(observedSummaryCount, logCount);
}

function cleanResultText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function readResultNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeDocumentNameForResultCheck(value: unknown): string {
    return cleanResultText(value)
        .replace(/\.(psd|psb)$/i, '')
        .toLowerCase();
}

function createDocumentNameMatches(expected: unknown, actual: unknown): boolean {
    const expectedName = normalizeDocumentNameForResultCheck(expected);
    const actualName = normalizeDocumentNameForResultCheck(actual);
    if (!expectedName || !actualName) return true;
    return expectedName === actualName
        || actualName.startsWith(`${expectedName} `)
        || actualName.startsWith(`${expectedName}-`)
        || actualName.startsWith(`${expectedName}_`);
}

function extractCreateDocumentResultRecord(result: unknown): Record<string, any> {
    const record = readResultRecord(result);
    const data = readResultRecord(record.data);
    return {
        ...readResultRecord(data.document),
        ...readResultRecord(record.document),
        ...record
    };
}

function buildCreateDocumentResultMismatch(input: {
    params: Record<string, any>;
    result: unknown;
}): string {
    const expectedName = cleanResultText(input.params.name);
    const expectedWidth = readResultNumber(input.params.width);
    const expectedHeight = readResultNumber(input.params.height);
    const actual = extractCreateDocumentResultRecord(input.result);
    const actualName = cleanResultText(actual.name);
    const actualWidth = readResultNumber(actual.width);
    const actualHeight = readResultNumber(actual.height);
    const blockers: string[] = [];

    if (expectedName && actualName && !createDocumentNameMatches(expectedName, actualName)) {
        blockers.push(`文档名称不一致：期望 ${expectedName}，实际 ${actualName}`);
    }
    if (expectedWidth !== undefined && actualWidth !== undefined && Math.round(expectedWidth) !== Math.round(actualWidth)) {
        blockers.push(`文档宽度不一致：期望 ${expectedWidth}，实际 ${actualWidth}`);
    }
    if (expectedHeight !== undefined && actualHeight !== undefined && Math.round(expectedHeight) !== Math.round(actualHeight)) {
        blockers.push(`文档高度不一致：期望 ${expectedHeight}，实际 ${actualHeight}`);
    }

    return blockers.join('；');
}

function readActiveDocumentNameFromResult(result: unknown): string {
    const record = readResultRecord(result);
    const data = readResultRecord(record.data);
    const document = {
        ...readResultRecord(data.document),
        ...readResultRecord(record.document)
    };
    return cleanResultText(
        document.name
        || record.name
        || data.name
        || record.documentName
        || data.documentName
        || record.activeDocumentName
        || data.activeDocumentName
    );
}

function readActiveDocumentIdFromResult(result: unknown): number | undefined {
    const record = readResultRecord(result);
    const data = readResultRecord(record.data);
    const document = {
        ...readResultRecord(data.document),
        ...readResultRecord(record.document)
    };
    const candidates = [
        record.id,
        data.id,
        record.documentId,
        record.activeDocumentId,
        document.documentId,
        document.id,
        data.documentId,
        data.activeDocumentId,
        readPhotoshopHistoryStateRef(result)?.documentId
    ];
    for (const candidate of candidates) {
        const documentId = Number(candidate);
        if (Number.isInteger(documentId) && documentId > 0) return documentId;
    }
    return undefined;
}

function readListedActiveDocumentIdentity(result: unknown): {
    documentId: number;
    documentName: string;
} | undefined {
    const record = readResultRecord(result);
    const data = readResultRecord(record.data);
    const documents = Array.isArray(record.documents)
        ? record.documents
        : Array.isArray(data.documents)
            ? data.documents
            : [];
    const activeDocumentId = readResultNumber(
        record.activeDocumentId ?? data.activeDocumentId
    );
    const activeDocuments = documents
        .map((item) => readResultRecord(item))
        .filter((item) => item.isActive === true);
    const activeRecord = activeDocumentId !== undefined
        ? documents
            .map((item) => readResultRecord(item))
            .find((item) => Number(item.documentId ?? item.id) === activeDocumentId)
        : activeDocuments.length === 1
            ? activeDocuments[0]
            : undefined;
    if (!activeRecord) return undefined;
    const documentId = Number(activeRecord.documentId ?? activeRecord.id ?? activeDocumentId);
    if (!Number.isInteger(documentId) || documentId <= 0) return undefined;
    return {
        documentId,
        documentName: cleanResultText(activeRecord.name || activeRecord.documentName)
    };
}

function hasSuccessfulNestedToolExecution(result: unknown, toolName: string): boolean {
    const record = readResultRecord(result);
    const data = readResultRecord(record.data);
    let toolResults: unknown[] = [];
    if (Array.isArray(record.toolResults)) {
        toolResults = record.toolResults;
    } else if (Array.isArray(data.toolResults)) {
        toolResults = data.toolResults;
    }
    return toolResults.some((item: unknown) => {
        const observation = readResultRecord(item);
        const nestedResult = readResultRecord(observation.result);
        return cleanResultText(observation.toolName) === toolName
            && nestedResult.success === true;
    });
}

interface AgentProviderToolDenyPolicy {
    deniedProviderToolNames: ReadonlySet<string>;
    deniedToolDomains: ReadonlySet<string>;
    workflowBridgeNames: ReadonlySet<string>;
}

type AgentProviderToolDenyMatch =
    | { kind: 'provider_name'; deniedName: string }
    | { kind: 'skill_dependency'; deniedName: string }
    | { kind: 'tool_domain'; deniedDomain: 'photoshop' };

type AgentProviderToolDenyEvaluationPhase = 'visibility' | 'execution';

function buildAgentProviderToolDenyPolicy(
    params?: Record<string, any>,
    workflowBridgeNames: ReadonlySet<string> = new Set<string>()
): AgentProviderToolDenyPolicy {
    const constraint = params?.agentCapabilityConstraint;
    return {
        deniedProviderToolNames: new Set(
            Array.isArray(constraint?.deniedProviderToolNames)
                ? constraint.deniedProviderToolNames
                    .map((name: unknown) => String(name || '').trim().toLowerCase())
                    .filter(Boolean)
                : []
        ),
        deniedToolDomains: new Set(
            Array.isArray(constraint?.deniedToolDomains)
                ? constraint.deniedToolDomains
                    .map((domain: unknown) => String(domain || '').trim().toLowerCase())
                    .filter(Boolean)
                : []
        ),
        workflowBridgeNames
    };
}

function resolveAgentProviderToolDenyMatch(
    policy: AgentProviderToolDenyPolicy,
    toolName: string,
    params: any,
    phase: AgentProviderToolDenyEvaluationPhase = 'execution'
): AgentProviderToolDenyMatch | null {
    const normalizedToolName = String(toolName || '').trim().toLowerCase();
    if (policy.deniedProviderToolNames.has(normalizedToolName)) {
        return { kind: 'provider_name', deniedName: toolName };
    }

    const skill = getSkillById(toolName);
    const deniedRequiredTool = skill?.requiredTools.find((requiredToolName) => (
        policy.deniedProviderToolNames.has(String(requiredToolName || '').trim().toLowerCase())
    ));
    if (deniedRequiredTool) {
        return { kind: 'skill_dependency', deniedName: deniedRequiredTool };
    }

    if (
        policy.deniedToolDomains.has('photoshop')
        && isPhotoshopDomainProviderTool(
            toolName,
            policy.workflowBridgeNames,
            params,
            phase === 'execution'
        )
    ) {
        return { kind: 'tool_domain', deniedDomain: 'photoshop' };
    }
    return null;
}

function buildAgentProviderToolDenyBlock(
    policy: AgentProviderToolDenyPolicy,
    toolName: string,
    params: any
): Record<string, any> | null {
    const match = resolveAgentProviderToolDenyMatch(policy, toolName, params);
    if (!match) return null;

    let code = 'provider_tool_forbidden_by_user';
    let message = `用户已明确禁止本轮调用 ${toolName}；该能力不会执行。`;
    if (match.kind === 'skill_dependency') {
        code = 'provider_tool_dependency_forbidden_by_user';
        message = `工作流 ${toolName} 依赖用户已明确禁用的能力 ${match.deniedName}；该工作流不会执行。`;
    } else if (match.kind === 'tool_domain') {
        code = 'provider_tool_domain_forbidden_by_user';
        message = `用户已明确禁止本轮调用需要 Photoshop 连接的能力；${toolName} 不会执行。`;
    }
    return {
        success: false,
        policyGate: true,
        code,
        message,
        error: message,
        blockedTool: toolName,
        ...(match.kind === 'provider_name' || match.kind === 'skill_dependency'
            ? { deniedProviderToolName: match.deniedName }
            : { deniedToolDomain: match.deniedDomain })
    };
}

interface RuntimeManifestBindingResult {
    success: boolean;
    code?: string;
    error?: string;
    issues?: Array<{ code: string; path: string }>;
    declarableTaskTypes?: string[];
    supportedWorkModes?: string[];
    correctedShape?: Record<string, string>;
    runtimeProfileId?: string;
}

function getRuntimeDeclarationRepairIssuePath(code: RuntimeDeclarationRepairCode): string {
    switch (code) {
        case 'task_type_missing':
        case 'task_type_unregistered':
        case 'task_type_not_declarable':
            return 'taskTypeId';
        case 'skill_id_unregistered':
            return 'skillId';
        case 'artifact_identity_conflict':
            return 'taskTypeId';
        case 'work_mode_required':
        case 'work_mode_invalid':
        case 'work_mode_not_applicable':
        case 'work_mode_unsupported':
            return 'workMode';
    }
}

function formatRuntimeDeclarationRepairError(
    resolution: Extract<RuntimeDeclarationResolution, { status: 'repair_required' }>
): string {
    switch (resolution.code) {
        case 'task_type_missing':
            return '设计 Runtime 声明缺少 taskTypeId。';
        case 'task_type_unregistered':
            return `设计任务类型「${resolution.requestedTaskType || '空'}」未注册。`;
        case 'task_type_not_declarable':
            return `设计任务类型「${resolution.requestedTaskType || '空'}」是内部方法身份，不能作为本轮交付物 Runtime。`;
        case 'skill_id_unregistered':
            return `Skill「${resolution.requestedSkillId || '空'}」未注册。`;
        case 'artifact_identity_conflict':
            return 'taskTypeId 与 Skill 指向不同交付物身份，不能绑定到同一 TaskRun。';
        case 'work_mode_required':
            return `任务类型「${resolution.requestedTaskType || '空'}」需要从已发布 Profile 中声明 workMode。`;
        case 'work_mode_invalid':
            return `workMode「${resolution.requestedWorkMode || '空'}」不是有效模式。`;
        case 'work_mode_not_applicable':
            return `任务类型「${resolution.requestedTaskType || '空'}」使用固定 #default Profile，必须省略 workMode。`;
        case 'work_mode_unsupported':
            return `任务类型「${resolution.requestedTaskType || '空'}」不支持 workMode「${resolution.requestedWorkMode || '空'}」。`;
    }
}

function buildRuntimeDeclarationBindingFailure(
    resolution: Exclude<RuntimeDeclarationResolution, { status: 'resolved' }>
): RuntimeManifestBindingResult {
    if (resolution.status === 'configuration_error') {
        const profileLabel = resolution.profileId ? `「${resolution.profileId}」` : '该 Runtime Profile';
        return {
            success: false,
            code: 'runtime_design_intent_configuration_error',
            error: `${profileLabel}未达到可发布条件，Harness 已停止绑定；不能通过降级或扩大权限绕过。`,
            issues: resolution.issues.map((issue) => ({ ...issue })),
            ...(resolution.profileId ? { runtimeProfileId: resolution.profileId } : {})
        };
    }

    const correctedShape: Record<string, string> = {};
    if (resolution.requestedTaskType) correctedShape.taskTypeId = resolution.requestedTaskType;
    if (resolution.code === 'work_mode_not_applicable') {
        correctedShape.workMode = 'omit';
    } else if (resolution.supportedWorkModes.length > 0) {
        correctedShape.workMode = 'choose_supported';
    } else if (resolution.code.startsWith('task_type_')) {
        correctedShape.taskTypeId = 'choose_declarable';
    }
    return {
        success: false,
        code: 'runtime_design_intent_declaration_invalid',
        error: formatRuntimeDeclarationRepairError(resolution),
        issues: [{
            code: resolution.code,
            path: getRuntimeDeclarationRepairIssuePath(resolution.code)
        }],
        declarableTaskTypes: [...resolution.declarableTaskTypes],
        supportedWorkModes: [...resolution.supportedWorkModes],
        correctedShape
    };
}

function applyRuntimeManifestBindingFailure(
    result: unknown,
    binding: RuntimeManifestBindingResult
): Record<string, unknown> {
    const record = result && typeof result === 'object' && !Array.isArray(result)
        ? result as Record<string, unknown>
        : {};
    const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
        ? record.data as Record<string, unknown>
        : {};
    const error = binding.error || '设计任务身份已声明，但本轮 Runtime 没有完成同代绑定。';
    const bindingDetails = {
        success: false,
        code: binding.code || 'runtime_manifest_binding_failed',
        ...(binding.issues ? { issues: binding.issues } : {}),
        ...(binding.declarableTaskTypes ? { declarableTaskTypes: binding.declarableTaskTypes } : {}),
        ...(binding.supportedWorkModes ? { supportedWorkModes: binding.supportedWorkModes } : {}),
        ...(binding.correctedShape ? { correctedShape: binding.correctedShape } : {}),
        ...(binding.runtimeProfileId ? { runtimeProfileId: binding.runtimeProfileId } : {})
    };
    return {
        ...record,
        success: false,
        code: binding.code || 'runtime_manifest_binding_failed',
        error,
        message: error,
        ...(binding.issues ? { issues: binding.issues } : {}),
        ...(binding.declarableTaskTypes ? { declarableTaskTypes: binding.declarableTaskTypes } : {}),
        ...(binding.supportedWorkModes ? { supportedWorkModes: binding.supportedWorkModes } : {}),
        ...(binding.correctedShape ? { correctedShape: binding.correctedShape } : {}),
        ...(binding.runtimeProfileId ? { runtimeProfileId: binding.runtimeProfileId } : {}),
        grantsPermission: false,
        countsAsTaskProgress: false,
        data: {
            ...data,
            runtimeManifestBinding: bindingDetails
        }
    };
}

function resolveTaskCardScope(context?: any, autonomousParams?: Record<string, any>): string {
    return String(
        context?.requestId
        || autonomousParams?.requestId
        || autonomousParams?.agentTaskPlan?.requestId
        || ''
    ).trim();
}

function createExecuteToolWrapper(
    callbacks?: AgentCallbacks,
    signal?: AbortSignal,
    context?: any,
    autonomousParams?: Record<string, any>,
    designerTeamConsultationContract?: ReturnType<typeof buildDesignerAgentTeamConsultationContract> | null,
    capabilitySession?: AgentCapabilitySession,
    dimensionSpec?: DesignDimensionSpec,
    userDocumentOverrides?: UserExplicitDocumentOverrides,
    providerToolDenyPolicy?: AgentProviderToolDenyPolicy,
    onDesignDisciplineContextChanged?: (disciplineContext: DesignDisciplineContext) => void,
    // 声明成功后由 executor 的单一提交边界同步绑定 Bundle / TaskRun / Capability / Agent。
    onRuntimeManifestDeclared?: (
        declaredTaskTypeId: string,
        declaredWorkMode?: string
    ) => Promise<RuntimeManifestBindingResult>,
    reserveDesignTeamChildExecution?: (input: {
        plannedRoles?: readonly DesignTeammateRole[];
        maxRevisions?: number;
        singleRole?: DesignTeammateRole;
    }) => DesignTeamChildExecutionReservation,
    // Harness 私有 TaskRun 身份投影的晚绑定读取器：manifest 声明可能在 Agent 循环中途才
    // 绑定 Runtime identity，wrapper 创建时不能冻结 undefined。它只是身份，不授权 Tool。
    getRuntimeTaskIdentity?: () => RuntimeSessionIdentity | undefined
): ExecuteToolFn {
    // 每次自主运行一个团队工作区：多次委派之间自动共享队友成果
    const teamWorkspace = new DesignTeamWorkspace();
    const projectPath: string | undefined = context?.projectContext?.projectPath;
    const taskCardScope = resolveTaskCardScope(context, autonomousParams);
    const effectiveProviderToolDenyPolicy = providerToolDenyPolicy
        || buildAgentProviderToolDenyPolicy(autonomousParams);
    const denyProviderTool: ProviderToolDenyEvaluator = (toolName, toolParams) => (
        buildAgentProviderToolDenyBlock(effectiveProviderToolDenyPolicy, toolName, toolParams)
    );
    const signedBaselineOptions: ToolCallExecutionOptions = {
        ...(taskCardScope ? { taskCardScope } : {}),
        ...(context?.guardedPhotoshopExecutionBaseline
            ? { guardedPhotoshopExecutionBaseline: context.guardedPhotoshopExecutionBaseline }
            : {})
    };
    const runDesignTeamCoordinator = createDesignTeamCoordinator(
        denyProviderTool,
        signedBaselineOptions
    );
    const executeAllowedProviderToolCall = async (
        toolName: string,
        toolParams: any,
        options: ToolCallExecutionOptions = {}
    ): Promise<any> => {
        const capabilityBlock = denyProviderTool(toolName, toolParams);
        if (capabilityBlock) return capabilityBlock;
        return executeToolCall(toolName, toolParams, {
            ...options,
            ...signedBaselineOptions
        });
    };
    const completedDesignTeamRoles = new Set<DesignTeammateRole>();
    let designTeamPipelineCompleted = false;
    let designTeamPipelineQualityPassed: boolean | undefined;
    let designTeamCriticQualityPassed: boolean | undefined;
    let designTeamPipelineAttempted = false;
    // A1.2：原详情页专属状态机已下沉为通用纪律（design-discipline-runtime）。
    // 去硬编码意图（P3）：纪律提前激活只采信结构化 owner；普通自然语言由真实设计
    // 行为足迹激活，也可选用声明补充精确 Profile。用户措辞关键词不拥有真实激活权，
    // 一旦结构化上下文或足迹激活即缓存不回退。
    const baseDisciplineContext = resolveAutonomousDesignDisciplineContext(autonomousParams, context);
    let activeDisciplineContext: DesignDisciplineContext | null =
        baseDisciplineContext.active ? baseDisciplineContext : null;
    const designBehaviorLog: Array<{ name?: string; result?: any }> = [];
    const reconciledVisualReviewResults = new WeakSet<object>();
    const resolveDisciplineContextForCall = (): DesignDisciplineContext => {
        if (activeDisciplineContext) return activeDisciplineContext;
        const signal = resolveDesignIntentSignal({
            toolCallLog: designBehaviorLog,
            declaredTaskType: autonomousParams?.declaredTaskType,
            // 纪律只能采信结构化声明或真实行为足迹，不能从用户措辞猜 Skill 身份。
            skillId: autonomousParams?.declaredSkillId,
            // 纵深防御：真实激活只采信已注册品类的声明 id。
            isValidTaskTypeId: isRegisteredDesignTaskTypeId
        });
        if (!signal.isDesign) return baseDisciplineContext;
        // 复用 baseDisciplineContext 已计算的参考/团队/交互布尔（避免重算，也不新增品类专属符号）。
        const resolved = resolveDesignDisciplineContext({
            taskText: getAutonomousTaskText(autonomousParams, context),
            isCreativeDesignIntent: true,
            // 声明式任务类型优先（评审修复 2026-07-03）：模型/上游声明的 taskTypeId 直接查表激活，
            // 不受 taskText 里 excludeSignals 措辞（如确认卡重提交文本中的「出图」）误杀。
            declaredTaskTypeId: signal.taskTypeId || resolveDeclaredDesignTaskTypeIdForAutonomousRun(autonomousParams),
            hasReferenceSource: baseDisciplineContext.hasReferenceSource,
            activeDocumentName: resolveCurrentPhotoshopDocumentName(context)
        });
        // 只缓存已激活上下文：避免一次被排除文本判为 inactive 后永久钉死，堵住后续移交激活通道。
        if (!resolved.active) return resolved;
        activeDisciplineContext = resolved;
        onDesignDisciplineContextChanged?.(resolved);
        return activeDisciplineContext;
    };
    /**
     * 移交续跑的确定性纪律激活（评审修复 2026-07-03）：工具结果携带 declaredDesignTaskTypeId
     * （如上游工作流因缺少前置能力而移交设计任务）时，立即以该任务类型
     * 激活纪律上下文——发生在设计动作（createDocument 等）之前，参考先行门禁因此可达；
     * 不依赖用户措辞正则，也不等行为足迹（足迹激活必然晚于首次 createDocument）。通用通道，
     * 任何品类的移交契约都可复用，executor 不含品类字面量。
     */
    const bindDeclaredDisciplineContextFromToolResult = async (
        result: unknown
    ): Promise<RuntimeManifestBindingResult | undefined> => {
        const declaredTaskTypeId = readDeclaredDesignTaskTypeIdFromToolResult(result);
        if (declaredTaskTypeId === undefined) return;
        const declaredWorkMode = readDeclaredDesignWorkModeFromToolResult(result);
        const record = result && typeof result === 'object' ? result as Record<string, any> : {};
        // declareDesignIntent 的成功结果仍可选绑定完整 Runtime。Skill 的 nonFatal 交接只激活
        // 通用设计纪律与其声明的原子续跑范围；不能把后台 Profile 绑定重新变成开工门槛。
        if (record.success !== false) {
            const runtimeBinding = await bindRuntimeManifestFromToolResult(
                declaredTaskTypeId,
                declaredWorkMode
            );
            if (!runtimeBinding.success) return runtimeBinding;
        }
        if (activeDisciplineContext?.active && activeDisciplineContext.taskTypeId === declaredTaskTypeId) {
            return undefined;
        }
        const rebound = resolveDesignDisciplineContext({
            taskText: getAutonomousTaskText(autonomousParams, context),
            isCreativeDesignIntent: true,
            declaredTaskTypeId,
            hasReferenceSource: baseDisciplineContext.hasReferenceSource,
            activeDocumentName: resolveCurrentPhotoshopDocumentName(context)
        });
        if (rebound.active) {
            activeDisciplineContext = rebound;
            onDesignDisciplineContextChanged?.(rebound);
        }
        return undefined;
    };
    /**
     * 普通自然语言请求在模型理解需求后原地绑定 Manifest：只收窄 Capability Session 的
     * activeTools，不重启 Agent、不递归重跑、不创建第二套 Runtime。被新 Manifest 禁止的
     * 能力由 bindManifest 内部的 deny-wins 丢弃；Agent 下一模型轮按新能力边界重新规划。
     */
    const bindRuntimeManifestFromToolResult = async (
        declaredTaskTypeId: string,
        declaredWorkMode?: string
    ): Promise<RuntimeManifestBindingResult> => {
        if (!capabilitySession || !onRuntimeManifestDeclared) {
            return {
                success: false,
                code: 'runtime_manifest_binding_owner_unavailable',
                error: '本轮 Runtime 绑定 Owner 不可用，任务身份声明未生效。'
            };
        }
        return await onRuntimeManifestDeclared(declaredTaskTypeId, declaredWorkMode);
    };
    // V0-4 重入播种（治理审计 2026-07-08）：reflexion 重入会用 createExecuteToolWrapper 新建
    // disciplineState（默认全 false）。若不回灌上一轮已确证的画布/排版事实，续跑 brief 说
    // 「文档已存在、直接置图」而纪律分支 4.1 因 documentCreated=false 强制 createDocument，
    // 在存量画布旁另建空文档。仅在重入轮（reflexionReentryInProgress）用上一轮 run-record
    // checkpoint 派生的确定性旗标播种；首轮或无种子时回退全 false，行为与旧版一致。
    const reflexionDisciplineSeed = autonomousParams?.reflexionReentryInProgress === true
        ? (autonomousParams?.reflexionDisciplineSeed as Partial<DesignDisciplineState> | undefined)
        : undefined;
    let disciplineState: DesignDisciplineState = createDesignDisciplineState(reflexionDisciplineSeed);
    const designDocumentRoleContext = buildDesignDocumentRoleContext({
        userInput: getAutonomousTaskText(autonomousParams, context),
        currentDocumentName: resolveCurrentPhotoshopDocumentName(context),
        hasCurrentDocument: resolveCurrentPhotoshopDocumentPresence(context) === true,
        workMode: normalizeRuntimeDesignWorkMode(autonomousParams?.declaredWorkMode)
    });
    let hasProtectedSource = designDocumentRoleContext.currentDocumentUse === 'protected';
    // 源稿名是写锁的身份依据，只有真的处于保护模式才成立。无条件记住当前文档名会让
    // 这个变量名说谎：开场只读观察（harness_opening_observation 的 getDocumentInfo）
    // 读回同名文档时被判成「回到受保护源稿」，凭空锁死用户本来就要写的那份文档。
    let protectedDocumentName = hasProtectedSource
        ? designDocumentRoleContext.currentDocumentName
        : '';
    // 写锁的第二个合法来源：Skill 在交接时声明「这份文档是本次任务的只读来源」（如批量生产的源色卡）。
    // 真机 2026-08-18 三次「帮我做SKU」都把模板 / 卡片叠到了源色卡上；来源文档 ≠ 产出文档有唯一答案，
    // 由 Skill 显式声明（带文档名 / id），不靠关键词，也不由开场观察武装。
    let protectedSourceReason: 'user_request' | 'skill_declared_source' = 'user_request';
    let protectedSourceNote = '';
    let protectedDocumentId = hasProtectedSource
        ? resolveCurrentPhotoshopDocumentId(context)
        : undefined;
    let mayLearnProtectedDocumentId = hasProtectedSource && protectedDocumentId === undefined;
    // 只有用户明确要求保护当前文档时才建立本地写锁。品类词、文件名和角色冲突都是
    // advisory；结构化 Runtime 的目标一致性由 documentId/revision preflight 验证。
    let activeDocumentWriteProtected = designDocumentRoleContext.currentDocumentUse === 'protected';

    // 始终跟踪纪律状态（即便尚未激活）：让行为足迹激活后状态与现实一致，避免 documentCreated 等漏记导致误拦。
    const recordDesignDisciplineProgress = (
        frameworkToolName: string,
        toolName: string,
        result: AgentResult | any,
        isPhotoshopMutation: boolean
    ) => {
        const visualReviewed = resolveVisualReviewedForDiscipline(result, toolName);
        disciplineState = applyDesignDisciplineProgress(
            disciplineState,
            toolName,
            result?.success !== false,
            { frameworkToolName, isPhotoshopMutation, visualReviewed }
        );
        designBehaviorLog.push({ name: toolName, result });
        if (visualReviewed && result && typeof result === 'object') {
            reconciledVisualReviewResults.add(result);
        }
    };
    const reconcileReviewedVisualObservations = (frameworkToolName: string): void => {
        designBehaviorLog.forEach((entry) => {
            const result = entry.result;
            if (!result || typeof result !== 'object') return;
            if (reconciledVisualReviewResults.has(result)) return;
            if (result.success === false) return;
            if (!resolveVisualReviewedForDiscipline(result, String(entry.name || ''))) return;
            disciplineState = applyDesignDisciplineProgress(
                disciplineState,
                String(entry.name || ''),
                true,
                { frameworkToolName, visualReviewed: true }
            );
            reconciledVisualReviewResults.add(result);
        });
    };

    return async (toolName, params, runtimeContext) => {
        const capabilityBlock = denyProviderTool(toolName, params);
        if (capabilityBlock) return capabilityBlock;
        if (isAgentMattingPaused() && isAgentMattingAtomicTool(toolName)) {
            return {
                success: false,
                policyGate: true,
                error: getAgentMattingPausedMessage()
            };
        }
        const hasPrivateTargetGuard = Object.prototype.hasOwnProperty.call(
            params || {},
            DESIGN_ECHO_TARGET_GUARD_ARGUMENT
        );
        const privateTargetGuard = readPrivateTargetGuard(
            params?.[DESIGN_ECHO_TARGET_GUARD_ARGUMENT]
        );
        if (hasPrivateTargetGuard && !privateTargetGuard) {
            return {
                success: false,
                policyGate: true,
                targetGuardCheckFailed: true,
                error: '执行目标守卫无效，已停止执行。请重新读取当前 Photoshop 文档后再试。'
            };
        }
        // 私有 target guard 只属于最终 UXP 执行边界。先从业务参数中剥离，避免进入
        // HITL 卡、设计纪律、参数归一化、Skill normalizedParams 或用户可见结果；
        // 原子工具在真正 executeToolCall 前再临时附回。
        params = stripPrivateTargetGuard(params || {});
        if (isCreateDocumentOperation(toolName, params)) {
            params = stripCreateDocumentPseudoConfirmation(params);
        }

        if (toolName === SEARCH_AGENT_CAPABILITIES_TOOL_NAME) {
            if (!capabilitySession) {
                return {
                    success: false,
                    error: '当前运行没有 Capability Session，无法检索能力。'
                };
            }
            const query = String(params?.query || '').trim();
            const result = capabilitySession.searchCapabilities(query, Number(params?.limit));
            return {
                success: query.length > 0,
                message: result.message,
                data: {
                    ...result,
                    changesModelVisibleSchemasOnly: false,
                    executesPhotoshop: false,
                    grantsPermission: false,
                    countsAsObservation: false,
                    countsAsTaskProgress: false,
                    countsAsRuntimeToolCall: false
                }
            };
        }

        if (toolName === REQUEST_AGENT_CAPABILITIES_TOOL_NAME) {
            if (!capabilitySession) {
                return {
                    success: false,
                    error: '当前运行没有 Capability Session，无法按需装载能力。'
                };
            }
            const requestedCapabilityIds = Array.isArray(params?.capabilityIds)
                ? params.capabilityIds.map((value: unknown) => String(value || '').trim()).filter(Boolean)
                : [];
            const activation = capabilitySession.requestCapabilities(requestedCapabilityIds);
            const alreadyActiveOnly = activation.status === 'rejected'
                && activation.issues.length > 0
                && activation.issues.every((issue) => (
                    issue.code === 'requested_capability_already_active'
                ));
            let message = `已为下一步装载 ${activation.activatedCapabilityIds.length} 项能力；本次没有执行 Photoshop 动作。`;
            if (alreadyActiveOnly) {
                message = '你请求的能力已经可用，请直接调用它提供的具体动作；本次没有重复装载，也没有执行 Photoshop。';
            } else if (activation.status === 'rejected') {
                // 真机 08-14→08-19 七次运行各撞一次：只说「没有装载」模型改不对；把每个 id 为什么不行说清，
                // 它才能一次改对（拼错 / 不在目录 / 被禁止），别再原样重试。
                const issueLines = (activation.issues || [])
                    .map((issue: any) => `${issue.capabilityId ? `「${issue.capabilityId}」` : ''}${issue.message || issue.code || ''}`.trim())
                    .filter(Boolean)
                    .slice(0, 6);
                message = `没有装载新的能力：${issueLines.length ? issueLines.join('；') : '请求的 id 不在当前目录里或已被禁止'}。请照能力目录里的 id 原样填写；已经可用的能力不用再请求，直接调用它的动作。`;
            }
            return {
                success: activation.status !== 'rejected' || alreadyActiveOnly,
                message,
                data: {
                    ...activation,
                    // 「请求已激活能力」是一次成功处理的幂等 no-op：不能伪装成任务进展，
                    // 也不能只靠 success=true 让循环守卫永远看不见。Agent 据此做独立的
                    // 有界 no-progress 会计；首次真实激活不会携带此标记。
                    idempotentNoOp: alreadyActiveOnly,
                    ...(alreadyActiveOnly
                        ? { noOpCode: 'requested_capabilities_already_active' }
                        : {}),
                    changesModelVisibleSchemasOnly: true,
                    executesPhotoshop: false,
                    grantsPermission: false,
                    countsAsObservation: false,
                    countsAsTaskProgress: false
                }
            };
        }

        const internalToolOwnerIds = getSkillInternalToolOwnerIds(toolName);
        if (internalToolOwnerIds.length > 0) {
            const activeCapabilityIds = capabilitySession?.getActiveCapabilityIdsForTool(toolName) || [];
            if (activeCapabilityIds.length === 0) {
                const skillFreeRun = areSkillBridgesForbidden(autonomousParams);
                const message = skillFreeRun
                    ? '这个领域原子能力尚未装载。请先从能力目录按用途检索并装载，再直接完成当前动作；不要因此改回 Skill 或只给方案。'
                    : '这个领域原子能力当前由业务 Skill owner 管理，不能绕过它直接调用。先让已选 Skill 处理；只有 Skill 明确交回原子续跑能力后，Agent 才能接手该动作。';
                return {
                    success: false,
                    policyGate: true,
                    code: skillFreeRun
                        ? 'skill_free_internal_tool_not_loaded'
                        : 'skill_internal_tool_owner_required',
                    message,
                    error: message,
                    ownerSkillIds: internalToolOwnerIds,
                    countsAsTaskProgress: false
                };
            }
        }

        if (isGenericBlockingInteractionTool(toolName)
            && !areSkillBridgesForbidden(autonomousParams)) {
            const taskType = resolveRuntimeInteractionTaskType(
                capabilitySession,
                autonomousParams
            );
            const interactionOwnerSkillIds = resolveProviderOwnedInteractionSkillIds(
                capabilitySession,
                autonomousParams
            );
            const ownerDecision = evaluateGenericBlockingCardOwner({
                skillBridgesForbidden: false,
                requiresResolvedOwner: requiresResolvedInteractionOwner(autonomousParams),
                resolvedTaskType: taskType,
                providerOwnerSkillIds: interactionOwnerSkillIds
            });
            if (ownerDecision.status === 'blocked'
                && ownerDecision.code === 'interactive_owner_unresolved') {
                const message = buildUnresolvedInteractionOwnerMessage(autonomousParams);
                return {
                    success: false,
                    policyGate: true,
                    code: 'interactive_owner_unresolved',
                    message,
                    error: message,
                    countsAsTaskProgress: false
                };
            }
            if (ownerDecision.status === 'blocked') {
                const message = '当前业务交互已由绑定的 Skill Provider 管理，通用选择或草稿卡不能复制它的字段、默认值或确认状态。请由对应 Skill 在真实前置条件准备完成后生成领域卡片。';
                return {
                    success: false,
                    policyGate: true,
                    code: 'skill_provider_interaction_owner_required',
                    message,
                    error: message,
                    ownerSkillIds: ownerDecision.ownerSkillIds,
                    countsAsTaskProgress: false
                };
            }
        }

        // 安全是全局最外层，独立于"是不是设计任务"（治理审计 2026-07-08）。V1-7b 正版 HITL：
        // 真正不可逆或外部敏感动作（不保存关档、真实浏览器 click…）命中 → 暂存本次确切调用 + 产人类确认卡 + 暂停循环，
        // 等用户在卡上确认后由 ChatPanel 确定性重放暂存的原始调用（红线 B）。evaluateHumanConfirmationGate 先剥离
        // 模型自带的确认参数再裁决——模型在自主循环里无法自我确认破坏性动作（红线 A：未经真人确认绝不执行）。
        // 返回值保留 policyGate/safetyBlock（通用循环豁免熔断/no_progress，且收集门据 safetyBlock 收集卡触发暂停）。
        const humanConfirmationGate = evaluateHumanConfirmationGate(toolName, params);
        if (humanConfirmationGate) {
            const pendingDestructiveCard = buildPendingDestructiveActionCard({
                verdict: humanConfirmationGate.verdict,
                toolName,
                params: humanConfirmationGate.strippedParams,
                // 确认后续跑用原始任务重发（ChatPanel 消费），避免续跑只剩确认话术、从零重做发现。
                sourceTask: getAutonomousTaskText(autonomousParams, context).slice(0, 500)
            });
            return buildPendingDestructiveActionBlockResult({
                verdict: humanConfirmationGate.verdict,
                card: pendingDestructiveCard
            });
        }

        const disciplineContext = resolveDisciplineContextForCall();
        // 图像工具返回后，Agent 才会把“视觉模型是否真正消费了图像”写回同一结果对象。
        // 下一次动作进入纪律门禁前补做一次对账，避免坐标/数字读回清掉“改后必看”，
        // 同时让真正完成的视觉复核可以解除写入等待。
        reconcileReviewedVisualObservations(disciplineContext.frameworkToolName);
        const designDisciplineActive = disciplineContext.active;
        // 只有结构化任务声明可以规范化文档名称、尺寸与 preset。自然语言和文件名推断的
        // targetRole 只出现在 Planner 提示中，不能静默改写真实工具参数。
        const targetDocumentRole = disciplineContext.spec?.runtimeHints.documentRole || 'unknown';
        let toolParams = designDisciplineActive && toolName === 'createDocument'
            ? normalizeCreateDocumentParamsForDesignRole(
                targetDocumentRole,
                params,
                {
                    canonicalName: true,
                    canonicalDimensions: true,
                    dimensionSpec,
                    userOverrides: userDocumentOverrides
                }
            )
            : designDisciplineActive && toolName === 'renderLayout'
                ? normalizeLayoutParamsForDesignRole(
                    targetDocumentRole,
                    params,
                    {
                        canonicalDimensions: true,
                        dimensionSpec,
                        userOverrides: userDocumentOverrides
                    }
                )
                : params;
        const createDocumentTargetBoundary = evaluateCreateDocumentTargetBoundary(
            designDocumentRoleContext
        );
        const createsDocument = isCreateDocumentOperation(toolName, toolParams);
        if (createsDocument && !createDocumentTargetBoundary.allowed) {
            return {
                success: false,
                policyGate: true,
                code: createDocumentTargetBoundary.code,
                message: createDocumentTargetBoundary.message,
                error: createDocumentTargetBoundary.message,
                ...(createDocumentTargetBoundary.nextRequiredTool
                    ? {
                        nextRequiredTool: createDocumentTargetBoundary.nextRequiredTool,
                        nextRequiredToolReason: '先重新绑定既有 Photoshop 目标，再决定后续动作。'
                    }
                    : {})
            };
        }
        const executionKind = classifyAgentToolExecution(toolName, toolParams);
        const closeDocumentId = Number(toolParams?.documentId);
        const hasCloseDocumentId = Number.isInteger(closeDocumentId) && closeDocumentId > 0;
        const closesProtectedDocumentById = hasProtectedSource
            && toolName === 'closeDocument'
            && protectedDocumentId !== undefined
            && hasCloseDocumentId
            && closeDocumentId === protectedDocumentId;
        const closesProtectedDocumentByName = hasProtectedSource
            && toolName === 'closeDocument'
            && !hasCloseDocumentId
            && Boolean(protectedDocumentName)
            && Boolean(normalizeDocumentNameForResultCheck(toolParams?.documentName))
            // UXP 按“真实文档名包含请求名”解析名称。这里只镜像同一方向：
            // “源稿”可能命中“源稿.psd”，但“源稿-副本.psd”不会反向命中源稿。
            && normalizeDocumentNameForResultCheck(protectedDocumentName).includes(
                normalizeDocumentNameForResultCheck(toolParams?.documentName)
            );
        const explicitlyClosesProtectedDocument = closesProtectedDocumentById
            || closesProtectedDocumentByName;
        // 用户保护是唯一进入此门禁的来源；它覆盖内容修改、显示状态、保存与导出。
        const changesProtectedDocument = explicitlyClosesProtectedDocument
            || (
                activeDocumentWriteProtected
                && !createsDocument
                && toolName !== 'openProjectFile'
                && toolName !== 'switchDocument'
                && (
                    executionKind === 'photoshop_write'
                    || executionKind === 'save_export'
                    || ['closeDocument', 'undo', 'redo'].includes(toolName)
                )
            );
        if (changesProtectedDocument) {
            const mayCreateSeparateTarget = createDocumentTargetBoundary.allowed;
            const documentLabel = protectedDocumentName || '未命名文档';
            const unlockHint = '请换一个目标文档：用 switchDocument / openProjectFile 绑定，或 createDocument 新建；listDocuments 只能列出文档，不会改变写入目标。';
            const message = protectedSourceReason === 'skill_declared_source'
                ? `「${documentLabel}」是本次任务的只读来源文档${protectedSourceNote ? `（${protectedSourceNote}）` : ''}，已阻止对它执行修改、保存或导出。产出请在另一份文档里做：createDocument 新建，或 openTemplate / switchDocument 到真正的目标文档。`
                : `用户明确要求保护当前文档「${documentLabel}」，已阻止对它执行修改、保存或导出。不要在这份文档上写入。${unlockHint}`;
            const unlockOptions = resolveCurrentDocumentWriteUnlockOptions(mayCreateSeparateTarget);
            return {
                success: false,
                policyGate: true,
                code: 'current_document_write_protected',
                message,
                error: message,
                // 单值字段保留给旧消费点；options 是可行出口集合，不授予权限也不限定下一轮工具面。
                nextRequiredTool: unlockOptions[0],
                nextRequiredToolOptions: unlockOptions,
                nextRequiredToolReason: mayCreateSeparateTarget
                    ? '用户保护只允许通过切换、打开或新建另一份目标文档解除；请按真实目标选择。'
                    : '解除写保护要用 switchDocument/openProjectFile 绑定真正的目标文档；重复读取文档列表不会解除写保护。'
            };
        }
        const designDisciplineGuardResult = evaluateDesignToolStateGuard({
            context: disciplineContext,
            state: disciplineState,
            toolName,
            toolParams,
            isPhotoshopMutation: executionKind === 'photoshop_write',
            trustedCreateDocumentAuthorization: createsDocument
                && createDocumentTargetBoundary.allowed
                && ['protected', 'separate_target'].includes(designDocumentRoleContext.currentDocumentUse)
        });
        // 设计路径宪法（2026-08-17）：「连续写入多次没回看」这类规则只提醒不拦截——工具照常执行，
        // 提醒附在结果里交给模型（真机 run [471]：主图被它连挡两次 transformLayer 后预算耗尽）。
        let disciplineAdvice: string | undefined;
        if (designDisciplineGuardResult && isAdvisoryDisciplineGuardResult(designDisciplineGuardResult)) {
            disciplineAdvice = designDisciplineGuardResult.message;
        } else if (designDisciplineGuardResult) {
            // 纪律守卫是"策略重定向/门禁"，不是工具执行失败：打 policyGate，切断
            // "策略否决→连续失败熔断→no_progress 停机"这条把 1-bit 误判放大成任务崩溃的链（治理审计 2026-07-08）。
            return { ...designDisciplineGuardResult, policyGate: true };
        }
        const declaredWorkModeForExecution = normalizeRuntimeDesignWorkMode(
            autonomousParams?.declaredWorkMode
        );
        if ((toolName === 'delegateToAgent' || toolName === 'runDesignTeamPipeline')
            && declaredWorkModeForExecution === 'edit_existing'
            && autonomousParams?.requiresDesignTeamConsultation !== true) {
            return {
                success: false,
                policyGate: true,
                code: 'design_team_not_available_for_scoped_edit',
                message: '这是有界局部编辑，直接完成目标读写与读回；本轮不启动额外设计团队。',
                error: '局部编辑未显式请求团队协作。',
                countsAsTaskProgress: false
            };
        }
        if (toolName === 'delegateToAgent') {
            const delegatedRole = String(toolParams?.role || '').trim() as DesignTeammateRole;
            const reservation = delegatedRole
                ? reserveDesignTeamChildExecution?.({
                    plannedRoles: [delegatedRole],
                    singleRole: delegatedRole,
                    maxRevisions: 0
                })
                : undefined;
            if (!reservation || reservation.status === 'blocked') {
                const code = reservation?.code || 'design_team_child_budget_owner_unavailable';
                const message = reservation?.reason
                    || '父 Agent 无法为单角色委派签发子预算；请直接执行当前任务或先完成 Runtime 身份声明。';
                return {
                    success: false,
                    policyGate: true,
                    blockedByPerformanceBudget: true,
                    code,
                    message,
                    error: message,
                    countsAsTaskProgress: false
                };
            }
            if (delegatedRole === 'executor') {
                // Executor 具备写入权限。委派一旦开始，旧版本的团队质量信用就不能继续
                // 为随后保存/导出背书；必须等新版本由 Critic 重新取得视觉回执。
                designTeamPipelineQualityPassed = undefined;
                designTeamCriticQualityPassed = undefined;
            }
            const result = await executeDelegateToAgent(
                toolParams,
                callbacks,
                signal,
                teamWorkspace,
                projectPath,
                runDesignTeamCoordinator,
                reservation.allowance
            );
            if (result?.success !== false) {
                const role = delegatedRole;
                if (role) {
                    completedDesignTeamRoles.add(role);
                }
                if (role === 'critic') {
                    const verdict = parseCriticVerdict(String(result?.message || ''));
                    const visualReviewEvidence = result?.visualReviewEvidence;
                    const hasVersionedVisualEvidence = Boolean(
                        visualReviewEvidence?.document
                        && visualReviewEvidence?.history
                        && visualReviewEvidence?.sourceTool
                    );
                    designTeamCriticQualityPassed = verdict.status === 'pass'
                        && hasVersionedVisualEvidence;
                }
            }
            return result;
        }
        if (toolName === 'runDesignTeamPipeline') {
            if (designTeamPipelineAttempted) {
                return {
                    success: false,
                    policyGate: true,
                    code: 'design_team_pipeline_already_attempted',
                    message: '本轮已经运行过一次完整设计团队流水线。请根据现有阶段结果做定向修改、单角色委派或直接复核，不要重复整条流水线。',
                    error: '完整设计团队流水线每轮最多运行一次。'
                };
            }
            if (privateTargetGuard) {
                const targetCheck = await executeAllowedProviderToolCall('getDocumentInfo', {
                    [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: privateTargetGuard
                }, { signal });
                if (targetCheck?.success === false) {
                    return {
                        ...targetCheck,
                        success: false,
                        policyGate: true,
                        targetGuardCheckFailed: true,
                        error: targetCheck?.error
                            || 'Photoshop 执行目标已变化，团队工作流未开始。请重新读取当前文档后再试。'
                    };
                }
            }
            const effectivePlannedRoles = resolveDesignTeamPipelinePlannedRoles(
                toolParams,
                designerTeamConsultationContract?.rolePlan.map((item) => item.role)
            );
            designTeamPipelineAttempted = true;
            const reservation = reserveDesignTeamChildExecution?.({
                plannedRoles: effectivePlannedRoles,
                maxRevisions: toolParams?.maxRevisions
            });
            if (!reservation || reservation.status === 'blocked') {
                const code = reservation?.code || 'design_team_child_budget_owner_unavailable';
                const message = reservation?.reason
                    || '父 Agent 无法为完整团队流水线保留收尾预算；请改用定向委派、直接执行或基于已有结果收尾。';
                return {
                    success: false,
                    policyGate: true,
                    blockedByPerformanceBudget: true,
                    code,
                    message,
                    error: message,
                    countsAsTaskProgress: false
                };
            }
            const globalEvaluationContext = buildDesignTeamGlobalEvaluationContext(
                runtimeContext,
                toolParams?.context
            );
            // 完整流水线包含可写 executor。真正启动后，任何旧 Critic / pipeline pass
            // 都不再代表本次将要产生的版本；新结果只能由本次流水线重新签发。
            designTeamPipelineQualityPassed = undefined;
            designTeamCriticQualityPassed = undefined;
            const result = await executeRunDesignTeamPipeline(
                {
                    ...toolParams,
                    context: globalEvaluationContext
                },
                callbacks,
                signal,
                projectPath,
                runDesignTeamCoordinator,
                effectivePlannedRoles,
                reservation.allowance
            );
            if (result?.success !== false) {
                designTeamPipelineCompleted = true;
                designTeamPipelineQualityPassed = result?.qualityPassed === true;
            }
            return result;
        }
        const designTeamProgress = buildDesignerAgentTeamConsultationProgress({
            contract: designerTeamConsultationContract,
            completedRoles: Array.from(completedDesignTeamRoles),
            pipelineCompleted: designTeamPipelineCompleted,
            pipelineQualityPassed: designTeamPipelineQualityPassed,
            criticQualityPassed: designTeamCriticQualityPassed,
            phase: executionKind === 'save_export' ? 'after_draft' : 'before_write'
        });
        // Design Team 是咨询/执行协作层，不是终局质量 owner。已绑定 Evaluation Profile
        // 的 Runtime 由 R5 对完整 ReviewSet 做唯一最终裁决；Team 的局部 Critic 结果可以
        // 驱动修订，但不能与 R5 形成第二套交付门禁或重复全量视觉费用。
        const runtimeProfileOwnsFinalQuality = Boolean(runtimeContext?.runtimeEvaluationProfile);
        if (
            designerTeamConsultationContract?.status === 'required'
            && (
                !designTeamProgress.readyForWrite
                || (executionKind === 'save_export'
                    && !designTeamProgress.qualityPassed
                    && !runtimeProfileOwnsFinalQuality)
            )
            && ['photoshop_write', 'save_export'].includes(executionKind)
        ) {
            const message = [
                executionKind === 'save_export'
                    ? '这次需要先完成专业评审，再保存或导出。'
                    : '这次需要先完成专业角色判断，再开始改动画面。',
                designTeamProgress.publicMessage,
                runtimeProfileOwnsFinalQuality
                    ? '最终质量由 Runtime R5 的完整画面集合统一裁决。'
                    : '',
                designTeamProgress.nextRequiredRole
                    ? `下一步请先让 ${designTeamProgress.nextRequiredRole} 完成对应判断。`
                    : ''
            ].filter(Boolean).join('\n');
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: 'delegateToAgent',
                nextRequiredToolReason: '专业角色建议完成后，主 Agent 再汇总并决定是否写入画面。'
            };
        }
        // 技能（多步工作流）在循环内以工具形式调用，约束在执行点强制
        if (isSkillToolName(toolName)) {
            if (areSkillBridgesForbidden(autonomousParams)) {
                const message = '用户已明确禁止本轮使用 Skill；请改用当前开放的原子工具完成目标。';
                return {
                    success: false,
                    policyGate: true,
                    code: 'skill_bridge_forbidden_by_user',
                    message,
                    error: message
                };
            }
            const skillBusinessParams = toolParams || {};
            const initialAtomicToolCalls: Array<{
                name: string;
                arguments?: any;
                result?: any;
            }> = [];
            if (privateTargetGuard) {
                // Workflow bridge 内部会继续派发多个原子动作，且技能本身就会开模板、切文档。
                // 这里**不能**拿主循环的期望目标当 fail-closed 门禁——真机 [491] 证明那会让
                // sku-batch 连续 14 次一步未跑就被中止（期望历史版本恒为 2777，实际一路涨到 3251）。
                // 正确做法：先做一次不带 guard 的真实观察，再由 shared 决策函数判断能否重新锚定。
                // 私有守卫不得进入 normalizedParams、Skill 结果或模型可见业务数据。
                const targetCheck = await executeAllowedProviderToolCall('getDocumentInfo', {}, { signal });
                const observedHistoryStateRef = readPhotoshopHistoryStateRef(targetCheck);
                const observedDocumentId = readObservedDocumentId('getDocumentInfo', targetCheck)
                    ?? observedHistoryStateRef?.documentId;
                const rebinding = resolveSkillWorkflowTargetRebinding({
                    skillId: toolName,
                    expected: {
                        documentId: privateTargetGuard.expectedDocumentId,
                        activeLayerId: privateTargetGuard.expectedActiveLayerId,
                        historyStateId: privateTargetGuard.expectedHistoryStateRef?.historyStateId
                    },
                    observed: {
                        documentId: observedDocumentId,
                        historyStateId: observedHistoryStateRef?.historyStateId,
                        documentName: String(readResultRecord(targetCheck).documentName || '').trim() || undefined
                    }
                });
                if (rebinding.action === 'block') {
                    return {
                        success: false,
                        policyGate: true,
                        code: rebinding.code,
                        blockedTool: toolName,
                        targetGuardCheckFailed: true,
                        error: `${rebinding.error} 只有这些动作会刷新执行目标：`
                            + `${SKILL_WORKFLOW_TARGET_REFRESH_TOOLS.join('、')}；`
                            + '项目资源检索、知识查询、状态读取都不会。',
                        executesPhotoshop: false,
                        grantsPermission: false,
                        countsAsObservation: false,
                        countsAsTaskProgress: false
                    };
                }
                // proceed 沿用期望目标；rebind 以真实观察为新锚点。两者都由技能内部
                // guard owner 继续逐调用签发 guard，保护层级没有下降。
                const anchorDocumentId = rebinding.action === 'rebind'
                    ? observedDocumentId
                    : privateTargetGuard.expectedDocumentId;
                const anchorHistoryStateRef = rebinding.action === 'rebind'
                    ? observedHistoryStateRef
                    : (observedHistoryStateRef || privateTargetGuard.expectedHistoryStateRef);
                initialAtomicToolCalls.push({
                    name: 'getDocumentInfo',
                    arguments: {},
                    result: {
                        ...readResultRecord(targetCheck),
                        success: true,
                        documentId: anchorDocumentId,
                        ...(rebinding.action !== 'rebind'
                            && privateTargetGuard.expectedActiveLayerId !== undefined
                            ? { activeLayerId: privateTargetGuard.expectedActiveLayerId }
                            : {}),
                        ...(anchorHistoryStateRef
                            ? { historyStateRef: anchorHistoryStateRef }
                            : {})
                    }
                });
            }
            const guardedAtomicToolExecutor = createGuardedAtomicToolExecutor({
                userRequest: getAutonomousTaskText(autonomousParams, context),
                initialCompletedToolCalls: initialAtomicToolCalls,
                executeTool: (atomicToolName, atomicToolParams) => executeAllowedProviderToolCall(
                    atomicToolName,
                    atomicToolParams,
                    { signal }
                )
            });
            const result = await executeSkillTool(toolName, skillBusinessParams, {
                // Skill 对外只呈现工作流阶段；内部原子工具结果仍由 Skill 记录并用于验收，
                // 不再逐条抬升为用户侧顶层步骤。外层 Agent 已显示 Skill 的开始与完成。
                callbacks: callbacks ? {
                    ...callbacks,
                    onToolStart: undefined,
                    onToolComplete: undefined
                } : callbacks,
                signal,
                context,
                guardedAtomicToolExecutor,
                // 读取 getter 最新值：identity 可能在本轮 manifest 绑定后才存在。
                runtimeTaskIdentity: getRuntimeTaskIdentity?.(),
                runtimeDesignBriefDeclaration: runtimeContext?.runtimeDesignBriefDeclaration,
                runtimeDesignBriefDigest: runtimeContext?.runtimeDesignBriefDigest,
                runtimeDesignBriefRequiredInputKeys: runtimeContext?.runtimeDesignBriefRequiredInputKeys,
                runtimeReferenceBriefDeclaration: runtimeContext?.runtimeReferenceBriefDeclaration,
                runtimeReferenceBriefDigest: runtimeContext?.runtimeReferenceBriefDigest,
                runtimeDesignStrategyDeclaration: runtimeContext?.runtimeDesignStrategyDeclaration,
                runtimeDesignStrategyDigest: runtimeContext?.runtimeDesignStrategyDigest,
                runtimeActionPlanDeclaration: runtimeContext?.runtimeActionPlanDeclaration,
                runtimeActionPlanDigest: runtimeContext?.runtimeActionPlanDigest,
                runtimeWorkflowDeliveryReentry: runtimeContext?.runtimeWorkflowDeliveryReentry
            });
            capabilitySession?.activateToolsForContinuation(
                readAgentReActRecoveryToolNames(result)
            );
            capabilitySession?.activateToolsForContinuation(
                readAgentEnvironmentRecoveryToolNames(result)
            );
            recordDesignDisciplineProgress(
                disciplineContext.frameworkToolName,
                toolName,
                result,
                executionKind === 'photoshop_write'
            );
            const runtimeBindingFailure = await bindDeclaredDisciplineContextFromToolResult(result);
            if (runtimeBindingFailure) {
                return markExternalContentTrust(
                    toolName,
                    applyRuntimeManifestBindingFailure(result, runtimeBindingFailure)
                );
            }
            // H3：先完成外部内容信任标记，再更新本地文档保护状态；后者不能绕过或替代信任边界。
            const trustedResult = markExternalContentTrust(toolName, result);
            if (executionKind === 'photoshop_write'
                && (result?.success !== false || findObservedPhotoshopMutationProof(result))) {
                // 任一后续画面写入都会使旧 Critic 回执过期。只有重新看过新版本，
                // 才能再次解锁显式团队模式下的保存/导出。
                designTeamPipelineQualityPassed = undefined;
                designTeamCriticQualityPassed = undefined;
            }
            if (result?.success !== false && hasSuccessfulNestedToolExecution(result, 'createDocument')) {
                activeDocumentWriteProtected = false;
            }
            const declaredSourceProtection = readSkillDeclaredSourceDocumentProtection(result);
            if (declaredSourceProtection) {
                hasProtectedSource = true;
                protectedSourceReason = 'skill_declared_source';
                protectedSourceNote = declaredSourceProtection.reason;
                protectedDocumentName = declaredSourceProtection.documentName;
                if (declaredSourceProtection.documentId !== undefined) {
                    protectedDocumentId = declaredSourceProtection.documentId;
                }
                mayLearnProtectedDocumentId = protectedDocumentId === undefined;
                // Skill 交接时活动文档就是这份来源文档；之后 createDocument / switchDocument / getDocumentInfo
                // 读回按既有逻辑开合这把锁。
                activeDocumentWriteProtected = true;
            }
            return trustedResult;
        }
        // H3：外部内容（网页/第三方库）进模型前打 untrusted 标记——数据不是指令（内部工具原样返回）
        const atomicExecutionParams = privateTargetGuard
            ? {
                ...toolParams,
                [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: privateTargetGuard
            }
            : toolParams;
        const result = markExternalContentTrust(
            toolName,
            await executeAllowedProviderToolCall(toolName, atomicExecutionParams, {
                signal,
                // 该 wrapper 只服务当前主 Agent。Task Profile 绑定会改变能力面和方法
                // 上下文，不会改变“谁在消费候选像素”的事实；绑定前后都必须走
                // calling_agent 中性观察路径，不能退回 Skill 内部推荐器。
                visualConsumptionOwner: 'calling_agent'
            })
        );
        if (getPhotoshopToolSkillSemantics(toolName, toolParams)?.requiresPhotoshopConnection === true) {
            capabilitySession?.activateToolsForContinuation(
                readAgentEnvironmentRecoveryToolNames(result)
            );
        }
        if (disciplineAdvice && result && typeof result === 'object' && !Array.isArray(result)) {
            // 只提醒：写入已执行，把「该回看一眼了」附在结果里，不改 success、不改任何字段语义。
            (result as Record<string, unknown>).disciplineAdvice = disciplineAdvice;
        }
        if (designDisciplineActive && toolName === 'createDocument' && result?.success !== false) {
            const mismatch = buildCreateDocumentResultMismatch({
                params: toolParams,
                result
            });
            if (mismatch) {
                const docLabel = disciplineContext.canonicalDocumentName || disciplineContext.label || '目标';
                return {
                    success: false,
                    message: `新建${docLabel}文档结果不一致，已停止继续写入。${mismatch}`,
                    error: `createDocument_result_mismatch: ${mismatch}`,
                    nextRequiredTool: 'createDocument',
                    nextRequiredToolReason: `Photoshop 返回的活动文档和请求的${docLabel}文档不一致，不能继续在错误文档上排版。`
                };
            }
        }
        // openProjectFile 只代表异步派发；它不解除源稿保护，但会终止“仍在开局源稿上”
        // 的一次性 ID 学习窗口，避免随后把同名目标误绑定成源稿。
        if (result?.success !== false && toolName === 'openProjectFile') {
            mayLearnProtectedDocumentId = false;
        }
        // createDocument 同步返回新目标；openProjectFile 必须等真实文档读回后才能解除源稿保护。
        if (result?.success !== false && toolName === 'createDocument') {
            activeDocumentWriteProtected = false;
            mayLearnProtectedDocumentId = false;
        } else if (result?.success !== false
            && hasProtectedSource
            && toolName === 'listDocuments'
            && protectedDocumentId === undefined
            && mayLearnProtectedDocumentId
            && activeDocumentWriteProtected) {
            const listedActiveDocument = readListedActiveDocumentIdentity(result);
            const listedNameMatchesProtected = !protectedDocumentName
                || (
                    listedActiveDocument?.documentName
                    && normalizeDocumentNameForResultCheck(listedActiveDocument.documentName)
                        === normalizeDocumentNameForResultCheck(protectedDocumentName)
                );
            if (listedActiveDocument && listedNameMatchesProtected) {
                // listDocuments 的 activeDocumentId + documents[].isActive 是一次真实的活动
                // 文档身份观察。只在仍锁住开局源稿的一次性学习窗口内绑定；绑定后即使
                // switch 到别处，按 ID 关闭后台源稿仍会被保护门禁拦住。
                protectedDocumentId = listedActiveDocument.documentId;
                mayLearnProtectedDocumentId = false;
            }
        } else if (result?.success !== false
            && hasProtectedSource
            && toolName === 'closeDocument') {
            // 关闭任意文档都可能让 Photoshop 自动切回开局源稿。close 回执没有稳定的
            // 新活动文档身份，因此在下一次 getDocumentInfo/switchDocument 读回前恢复保护。
            activeDocumentWriteProtected = true;
            mayLearnProtectedDocumentId = false;
        } else if (result?.success !== false
            && hasProtectedSource
            && (toolName === 'switchDocument' || toolName === 'getDocumentInfo')) {
            // 与上面两个兄弟分支一致：这里只维护「用户要求的保护」这把锁的开合。
            // 未进入保护模式时读回文档身份不产生任何权限含义，绝不能由只读观察加锁。
            const activeDocumentId = readActiveDocumentIdFromResult(result);
            const activeDocumentName = readActiveDocumentNameFromResult(result);
            if (hasProtectedSource
                && protectedDocumentId === undefined
                && mayLearnProtectedDocumentId
                && toolName === 'getDocumentInfo'
                && activeDocumentWriteProtected
                && activeDocumentId !== undefined
                && (
                    !protectedDocumentName
                    || (
                        activeDocumentName
                        && normalizeDocumentNameForResultCheck(activeDocumentName)
                            === normalizeDocumentNameForResultCheck(protectedDocumentName)
                    )
                )) {
                // 开局只有名称时，仅允许“仍处于受保护源稿上的可信读回”补齐 ID。
                // 一旦绑定便不再漂移；切到同名副本后的读回也不能覆盖源身份。
                protectedDocumentId = activeDocumentId;
            }
            mayLearnProtectedDocumentId = false;
            if (activeDocumentId !== undefined && protectedDocumentId !== undefined) {
                activeDocumentWriteProtected = activeDocumentId === protectedDocumentId;
            } else if (activeDocumentName) {
                const backToProtectedDocument = normalizeDocumentNameForResultCheck(activeDocumentName)
                    === normalizeDocumentNameForResultCheck(protectedDocumentName);
                activeDocumentWriteProtected = backToProtectedDocument;
            }
        }
        recordDesignDisciplineProgress(
            disciplineContext.frameworkToolName,
            toolName,
            result,
            executionKind === 'photoshop_write'
        );
        if (executionKind === 'photoshop_write'
            && (result?.success !== false || findObservedPhotoshopMutationProof(result))) {
            designTeamPipelineQualityPassed = undefined;
            designTeamCriticQualityPassed = undefined;
        }
        const runtimeBindingFailure = await bindDeclaredDisciplineContextFromToolResult(result);
        if (runtimeBindingFailure) {
            return applyRuntimeManifestBindingFailure(result, runtimeBindingFailure);
        }
        return result;
    };
}

/**
 * Skill 在结果 data 里声明的只读来源文档：{ protectSourceDocument: { documentName, documentId?, reason? } }。
 * 只认结构化字段，不从文案里猜；名字为空时不武装。
 */
function readSkillDeclaredSourceDocumentProtection(result: unknown): {
    documentName: string;
    documentId?: number;
    reason: string;
} | undefined {
    const data = (result as { data?: unknown } | null | undefined)?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
    const raw = (data as Record<string, unknown>).protectSourceDocument;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const record = raw as Record<string, unknown>;
    const documentName = String(record.documentName || '').trim();
    if (!documentName) return undefined;
    const documentId = Number(record.documentId);
    return {
        documentName,
        ...(Number.isInteger(documentId) && documentId > 0 ? { documentId } : {}),
        reason: String(record.reason || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    };
}

function getAutonomousTaskText(params?: Record<string, any>, context?: any): string {
    return String(
        params?.userTask
        || params?.task
        || params?.userInput
        || context?.userInput
        || ''
    ).trim();
}

function resolveCurrentPhotoshopDocumentPresence(context?: any): boolean | undefined {
    const snapshot = context?.operatingContextSnapshot;
    if (snapshot) {
        if (snapshot.photoshop?.observation?.freshness !== 'current') return undefined;
        if (snapshot.photoshop.documentState === 'present') return true;
        if (snapshot.photoshop.documentState === 'absent') return false;
        return undefined;
    }
    return context?.photoshopContext?.hasDocument;
}

function resolveCurrentPhotoshopConnection(context?: any): boolean | undefined {
    if (context?.operatingContextSnapshot) {
        return resolveOperatingPhotoshopConnection(context.operatingContextSnapshot);
    }
    return context?.isPluginConnected;
}

function resolveCurrentPhotoshopDocumentName(context?: any): string | undefined {
    if (resolveCurrentPhotoshopDocumentPresence(context) !== true) return undefined;
    return context?.operatingContextSnapshot?.photoshop?.document?.name
        || context?.photoshopContext?.documentName;
}

function resolveCurrentPhotoshopDocumentId(context?: any): number | undefined {
    if (resolveCurrentPhotoshopDocumentPresence(context) !== true) return undefined;
    const documentId = Number(
        context?.operatingContextSnapshot?.photoshop?.document?.documentId
        ?? context?.photoshopContext?.documentId
    );
    return Number.isInteger(documentId) && documentId > 0 ? documentId : undefined;
}

function hasResolvedRuntimeInputValue(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return Boolean(value.trim());
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
    return true;
}

function toCamelInputKey(inputKey: string): string {
    return inputKey.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

export function buildAutonomousDesignBriefInputSources(input: {
    params: Record<string, any>;
    context?: any;
    runtimeContractBundle: AgentTaskRuntimeContractBundle;
}): RuntimeDesignBriefAvailableInputSource[] {
    const inputKeys = Object.keys(input.runtimeContractBundle.stagePlan.inputSources);
    const structuredRecords = [
        input.params.skillParams,
        input.params
    ].filter((value) => value && typeof value === 'object' && !Array.isArray(value)) as Record<string, unknown>[];
    const structuredInputKeys = inputKeys.filter((inputKey) => {
        const aliases = [inputKey, toCamelInputKey(inputKey)];
        return structuredRecords.some((record) => aliases.some((alias) => (
            hasResolvedRuntimeInputValue(record[alias])
        )));
    });
    const project = input.context?.projectContext || {};
    const projectAssetCount = Math.max(
        Number(project.projectImageCount || 0),
        Number(project.assetIndex?.summary?.totalImages || 0),
        Array.isArray(project.sampleImagePaths) ? project.sampleImagePaths.length : 0
    );
    const contextProduct = project.contextSnapshot?.payload?.product
        || project.contextSnapshot?.product;
    const hasProjectProduct = Boolean(contextProduct && typeof contextProduct === 'object' && (
        String(contextProduct.name || '').trim()
        || String(contextProduct.category || '').trim()
        || (Array.isArray(contextProduct.facts) && contextProduct.facts.length > 0)
        || (Array.isArray(contextProduct.visibleFeatures) && contextProduct.visibleFeatures.length > 0)
    ));
    const hasAttachedImage = Array.isArray(input.params.images) && input.params.images.length > 0;
    const hasUserGoal = Boolean(getAutonomousTaskText(input.params, input.context));
    return [
        ...(hasUserGoal ? [{ sourceKind: 'user_goal' as const }] : []),
        ...(structuredInputKeys.length > 0
            ? [{ sourceKind: 'structured_input' as const, inputKeys: structuredInputKeys }]
            : []),
        ...(hasAttachedImage ? [{ sourceKind: 'attached_image' as const }] : []),
        ...(projectAssetCount > 0 ? [{ sourceKind: 'project_asset' as const }] : []),
        ...(String(project.selectedProjectImagePath || '').trim()
            ? [{ sourceKind: 'selected_project_asset' as const }]
            : []),
        ...(hasProjectProduct ? [{ sourceKind: 'project_product' as const }] : []),
        ...(project.hasSkuFiles === true ? [{ sourceKind: 'project_sku' as const }] : []),
        ...(project.hasTemplates === true ? [{ sourceKind: 'project_template' as const }] : []),
        ...(resolveCurrentPhotoshopDocumentPresence(input.context) === true
            ? [{ sourceKind: 'photoshop_document' as const }]
            : []),
        ...(project.projectId || project.projectPath || project.contextSnapshot
            ? [{ sourceKind: 'project_context' as const }]
            : [])
    ];
}

/**
 * 显式 agentic Runtime 声明的唯一提交边界。
 *
 * Agent 契约与 owner-only Capability 必须在同一次同步提交中生效；这里不执行
 * Skill、不授予 Photoshop 权限，也不根据用户文字选择 Manifest。
 */
export function commitAgenticRuntimeDeclarationBinding(input: {
    agent: Pick<Agent, 'activateAgenticRuntimeContractFromDeclaration'>;
    capabilitySession: Pick<AgentCapabilitySession, 'bindAgenticManifestOwner'>;
    manifest: SkillRuntimeManifest;
    activation: Parameters<Agent['activateAgenticRuntimeContractFromDeclaration']>[0];
}): boolean {
    if (!input.capabilitySession.bindAgenticManifestOwner(input.manifest)) return false;
    input.agent.activateAgenticRuntimeContractFromDeclaration(input.activation);
    return true;
}

function isAutonomousCreativeDesignTask(
    params?: Record<string, any>,
    _context?: any
): boolean {
    // 普通自然语言统一交给主 Agent。设计纪律的提前激活只采信结构化 owner，
    // 不从控制面关键词信号反推“这是创意设计”；未结构化请求可直接执行，
    // 并由真实设计行为足迹激活通用纪律。
    return params?.requiresDesignerAgentDecision === true;
}

/**
 * 解析本轮由结构化 owner 显式提供的任务类型。自然语言里的品类词不在模型判断前
 * 变成真实设计纪律；普通请求无需先声明，可由真实设计行为足迹激活。
 */
function resolveDeclaredDesignTaskTypeIdForAutonomousRun(
    params?: Record<string, any>
): string | undefined {
    const direct = String(params?.declaredTaskType || '').trim();
    return direct || undefined;
}

/**
 * 能真正解除当前文档写保护的工具——门禁只从这里报告可行出口。
 * 写保护的解除点在 createExecuteToolWrapper 内（createDocument 同步解除；switchDocument
 * 按真实结果重算；openProjectFile 要等后续活动文档观察）；listDocuments 等只读工具不在其中，指向它们会让模型
 * 「照做 → 原样重试 → 撞回同一堵墙」，把工具预算烧干还解不开锁（真机曾 4 次重试全废）。
 */
const CURRENT_DOCUMENT_WRITE_UNLOCK_TOOLS = ['createDocument', 'openProjectFile', 'switchDocument'] as const;

type CurrentDocumentWriteUnlockTool = typeof CURRENT_DOCUMENT_WRITE_UNLOCK_TOOLS[number];

/**
 * 写保护门禁的出口说明：返回**全部**当前可行的出路，而不是替模型挑一条。
 *
 * 返回类型钉在解锁集合上：写成 listDocuments 之类解不开锁的工具会直接编译失败，
 * 让「指路必可达」成为结构约束而不是靠评审或测试发现。
 *
 * 为什么必须给全集（2026-07-31 真机死锁）：用户开着「详情页.psb」要求调整 SKU，
 * 模型已查明「SKU.psb 已经在 Photoshop 中打开了（id=5095）」、有 6 个颜色变体，
 * 判断完全正确——该切过去改，而不是另建空白文档。但门禁只发了 createDocument 一个值，
 * 而旧 Agent 循环曾把 nextRequiredTool 翻译成**单工具 allowlist**，于是下一轮模型只被允许调 createDocument。
 * 它不肯建错文档，又没有第二条被允许的路，只能一直调只读工具，最终 12 次查看、0 次改动。
 *
 * 排序说明：switchDocument 在前只是兼容旧 nextRequiredTool 单值字段时的取值，
 * 不代表系统认定它更对——切到已打开的目标是可逆的，误建空白文档会污染画面且要人工收拾，
 * 这与 design-discipline-runtime 中「存量修改应在已打开的目标文档上进行」同向。
 * 真正的选择权在模型：三条只作为事实性恢复选项进入 Tool 结果。
 */
function resolveCurrentDocumentWriteUnlockOptions(
    mayCreateSeparateTarget: boolean
): CurrentDocumentWriteUnlockTool[] {
    return mayCreateSeparateTarget
        ? ['switchDocument', 'openProjectFile', 'createDocument']
        : ['switchDocument', 'openProjectFile'];
}

/** 通用读取：工具结果携带的声明式任务类型 id（移交契约 data.declaredDesignTaskTypeId）。 */
function readDeclaredDesignTaskTypeIdFromToolResult(result: unknown): string | undefined {
    const record = result && typeof result === 'object' ? result as Record<string, any> : {};
    if (record.success === false && record.nonFatal !== true) return undefined;
    const data = record.data && typeof record.data === 'object' ? record.data as Record<string, any> : {};
    if (!Object.prototype.hasOwnProperty.call(data, 'declaredDesignTaskTypeId')) return undefined;
    return String(data.declaredDesignTaskTypeId || '').trim();
}

/** 通用读取：保留 R0 声明的原始 workMode，由唯一 Runtime Resolver 归一和裁决。 */
function readDeclaredDesignWorkModeFromToolResult(result: unknown): string | undefined {
    const record = result && typeof result === 'object' ? result as Record<string, any> : {};
    if (record.success === false) return undefined;
    const data = record.data && typeof record.data === 'object' ? record.data as Record<string, any> : {};
    if (!Object.prototype.hasOwnProperty.call(data, 'declaredDesignWorkMode')) return undefined;
    return String(data.declaredDesignWorkMode || '').trim();
}

/**
 * 解析当前自主任务的「通用设计纪律上下文」（A1.2 通用守卫激活口径）。
 * 创意意图与任务类型只由结构化 owner 或模型声明提供，
 * 参考来源只供显式 reference-first policy 使用；团队、交互及其它能力始终由 Planner
 * 从 Capability Registry 自主选择，不再通过品类布尔开关隐藏。
 */
function resolveAutonomousDesignDisciplineContext(
    params?: Record<string, any>,
    context?: any
): DesignDisciplineContext {
    return resolveDesignDisciplineContext({
        taskText: getAutonomousTaskText(params, context),
        isCreativeDesignIntent: isAutonomousCreativeDesignTask(params, context),
        declaredTaskTypeId: resolveDeclaredDesignTaskTypeIdForAutonomousRun(params),
        hasReferenceSource: hasExplicitDesignReferenceSource(params, context),
        activeDocumentName: resolveCurrentPhotoshopDocumentName(context)
    });
}

function resolveDesignerAgentScenario(
    params?: Record<string, any>,
    _context?: any
): DesignAgentOsScenario {
    const skillId = String(params?.declaredSkillId || '').trim();
    const declaredTaskTypeId = resolveDeclaredDesignTaskTypeIdForAutonomousRun(params);
    const declaredTaskTypeSpec = getDesignTaskTypeSpec(declaredTaskTypeId)
        || getDesignTaskTypeSpecBySkillId(skillId);
    if (declaredTaskTypeSpec) return declaredTaskTypeSpec.runtimeHints.scenario;
    if (isAutonomousCreativeDesignTask(params, _context)) return 'general-design';
    return 'unknown';
}

function extractDesignerAgentDecision(params?: Record<string, any>): any {
    const candidates = [
        params?.designIntelligenceDecision,
        params?.designAgentDecision,
        params?.agentDesignDecision
    ];
    return candidates.find((item) => item && typeof item === 'object' && !Array.isArray(item)) || null;
}

function buildDesignerAgentDecisionInput(
    params?: Record<string, any>,
    context?: any
) {
    return {
        userTask: getAutonomousTaskText(params, context),
        scenario: resolveDesignerAgentScenario(params, context),
        visualInsightCache: context?.projectContext?.visualInsightCache,
        agentDecision: extractDesignerAgentDecision(params)
    };
}

function buildDesignerAgentTeamConsultationInput(
    params?: Record<string, any>,
    context?: any,
    decisionStatus?: ReturnType<typeof buildDesignerAgentDecisionContract>['status']
) {
    const userTask = getAutonomousTaskText(params, context);
    return {
        userTask,
        scenario: resolveDesignerAgentScenario(params, context),
        decisionStatus,
        workMode: normalizeRuntimeDesignWorkMode(params?.declaredWorkMode),
        // 只有结构化调用方能把团队协作提升为硬门禁。自然语言由主 Agent 理解并自主调用团队工具。
        explicitTeamRequest: params?.requiresDesignTeamConsultation === true,
        specialistRoles: Array.isArray(params?.designTeamSpecialistRoles)
            ? params.designTeamSpecialistRoles
            : undefined
    };
}

function isCompleteAgentIntentControlPlaneDecision(
    value: unknown
): value is AgentIntentControlPlaneDecision {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Partial<AgentIntentControlPlaneDecision>;
    return record.version === 'agent-intent-control-plane/v0'
        && typeof record.requestKind === 'string'
        && typeof record.toolScope === 'string'
        && typeof record.shouldUseConversationalPath === 'boolean'
        && typeof record.allowsDeterministicRoute === 'boolean'
        && typeof record.allowsRouterModel === 'boolean'
        && typeof record.allowsAutonomousExecution === 'boolean'
        && typeof record.requiresClarificationBeforeTools === 'boolean'
        && typeof record.executionAuthorization === 'string'
        && typeof record.executionDisposition === 'string'
        && typeof record.reason === 'string'
        && typeof record.userVisibleSummary === 'string'
        && Array.isArray(record.matchedSignals);
}

function completeAutonomousAgentIntentControlPlane(
    params: Record<string, any> = {},
    context?: any,
    userTask = ''
): AgentIntentControlPlaneDecision {
    const provided = params.agentIntentControlPlane;
    if (isCompleteAgentIntentControlPlaneDecision(provided)) {
        return {
            ...provided,
            matchedSignals: [...provided.matchedSignals]
        };
    }
    const fallback = buildAgentIntentControlPlaneDecision({
        userInput: userTask || getAutonomousTaskText(params, context),
        hasImageInput: Array.isArray(params.images) && params.images.length > 0,
        hasDocument: resolveCurrentPhotoshopDocumentPresence(context),
        photoshopConnected: resolveCurrentPhotoshopConnection(context)
    });
    if (!provided || typeof provided !== 'object' || Array.isArray(provided)) {
        return fallback;
    }

    const record = provided as Partial<AgentIntentControlPlaneDecision>;
    return {
        ...fallback,
        ...record,
        version: 'agent-intent-control-plane/v0',
        requestKind: record.requestKind || fallback.requestKind,
        toolScope: record.toolScope || fallback.toolScope,
        shouldUseConversationalPath: record.shouldUseConversationalPath ?? fallback.shouldUseConversationalPath,
        allowsDeterministicRoute: record.allowsDeterministicRoute ?? fallback.allowsDeterministicRoute,
        allowsRouterModel: record.allowsRouterModel ?? fallback.allowsRouterModel,
        allowsAutonomousExecution: record.allowsAutonomousExecution ?? fallback.allowsAutonomousExecution,
        requiresClarificationBeforeTools: record.requiresClarificationBeforeTools ?? fallback.requiresClarificationBeforeTools,
        executionAuthorization: record.executionAuthorization || fallback.executionAuthorization,
        executionDisposition: record.executionDisposition || fallback.executionDisposition,
        reason: record.reason || fallback.reason,
        userVisibleSummary: record.userVisibleSummary || fallback.userVisibleSummary,
        matchedSignals: Array.from(new Set([
            ...(fallback.matchedSignals || []),
            ...(record.matchedSignals || [])
        ]))
    };
}

function hasExplicitDesignReferenceSource(params?: Record<string, any>, context?: any): boolean {
    const userTask = getAutonomousTaskText(params, context);
    return /https?:\/\/|www\.|参考链接|参考这个|参考页面|按.*(?:链接|网址|页面)|复刻|对标/.test(userTask);
}

function resolveAutonomousPerformancePolicy(
    params: Record<string, any>,
    context: any,
    designDisciplineContext: DesignDisciplineContext,
    runtimeContractBundle?: AgentTaskRuntimeContractBundle
): AgentPerformancePolicy | undefined {
    if (!designDisciplineContext.active && !runtimeContractBundle) {
        return buildAgentUnboundAutonomousPerformancePolicy();
    }
    const projectContext = context?.projectContext || {};
    const projectImageCount = Number(
        projectContext.projectImageCount
        || projectContext.assetIndex?.summary?.totalImages
        || 0
    );
    const visualSamplingCandidateCount = Number(
        projectContext.visualSamplingCandidateCount
        || projectContext.visualSamplingPlan?.selectedCandidates?.length
        || 0
    );
    const performanceSkillId = runtimeContractBundle?.methodManifests[0]?.skill_id
        || runtimeContractBundle?.artifactManifest?.skill_id
        || runtimeContractBundle?.manifest.skill_id
        || 'autonomous-agent';
    const performanceTaskType = runtimeContractBundle?.artifactManifest?.task_type
        || runtimeContractBundle?.manifest.task_type
        || designDisciplineContext.taskTypeId;
    return buildAgentPerformancePolicy({
        userText: getAutonomousTaskText(params, context),
        scenario: designDisciplineContext.spec?.runtimeHints.scenario
            || resolveDesignerAgentScenario(params, context),
        action: 'create',
        skillId: performanceSkillId,
        taskType: performanceTaskType,
        workMode: runtimeContractBundle?.stagePlan.expectedWorkMode,
        requiresPhotoshop: true,
        projectImageCount: Number.isFinite(projectImageCount) ? projectImageCount : 0,
        visualSamplingCandidateCount: Number.isFinite(visualSamplingCandidateCount) ? visualSamplingCandidateCount : 0
    });
}

function toAgentPerformanceBudget(
    policy: AgentPerformancePolicy
): NonNullable<AgentConfig['performanceBudget']> {
    return {
        maxModelCalls: policy.budget.maxModelCalls,
        maxToolCalls: policy.budget.maxToolCalls,
        maxVisionCandidates: policy.budget.maxVisionCandidates,
        maxInitialVisionCandidates: policy.budget.maxInitialVisionCandidates,
        maxVisualAnalyses: policy.budget.maxVisualAnalyses,
        maxFullResolutionImageReads: policy.budget.maxFullResolutionImageReads,
        softTimeBudgetMs: policy.budget.softTimeBudgetMs,
        maxPrimaryOutputTokens: policy.budget.maxPrimaryOutputTokens,
        allowProviderThinking: policy.budget.allowProviderThinking
    };
}

function buildAgenticArtifactCompletionContract(
    bundle: AgentTaskRuntimeContractBundle
): AgenticArtifactCompletionContract | undefined {
    const effectiveContract = resolveRuntimeStagePlanEffectiveContract(
        bundle.stagePlan,
        bundle.stagePlan.expectedWorkMode
    );
    if (!effectiveContract) return undefined;
    const workflowProducerSkillIds = Array.from(new Set(
        (bundle.manifest.workflow_entry_skill_ids?.length
            ? bundle.manifest.workflow_entry_skill_ids
            : bundle.manifest.legacy_skill_ids || [])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    ));
    return {
        version: 'agentic-artifact-completion-contract/v0',
        skillId: bundle.manifest.skill_id,
        taskType: bundle.manifest.task_type,
        ...(effectiveContract.workMode ? { workMode: effectiveContract.workMode } : {}),
        ...(effectiveContract.productionObligation
            ? { productionObligation: effectiveContract.productionObligation }
            : {}),
        ...(effectiveContract.deliveryPlanBindingRequired === true
            ? {
                deliveryPlanBindingRequired: true as const,
                deliveryReceiptProducerSkillIds: workflowProducerSkillIds
            }
            : {}),
        deliveryOutputs: [...effectiveContract.deliveryOutputs],
        exitCriteria: [...effectiveContract.exitCriteria],
        ...(effectiveContract.reviewRubricRef
            ? { reviewRubricRef: effectiveContract.reviewRubricRef }
            : {})
    };
}

export interface AutonomousAgenticRuntimeBindingProjection {
    artifactContract: AgenticArtifactCompletionContract;
    bindingContext: AgenticRuntimeBindingContext;
    contextItem: RuntimeContextItem;
}

/**
 * 让“进入 Agent 前已绑定”和“Agent 循环内声明”复用完全相同的 agentic 责任投影。
 * 本函数只读取当前请求已有来源和 Manifest 义务，不选择设计内容或授予执行权限。
 */
export function buildAutonomousAgenticRuntimeBindingProjection(input: {
    runtimeContractBundle: AgentTaskRuntimeContractBundle;
    params: Record<string, any>;
    context?: any;
}): AutonomousAgenticRuntimeBindingProjection | undefined {
    const artifactContract = buildAgenticArtifactCompletionContract(input.runtimeContractBundle);
    if (!artifactContract) return undefined;
    const bindingContext = buildAgenticRuntimeBindingContext({
        manifest: input.runtimeContractBundle.manifest,
        workMode: input.runtimeContractBundle.stagePlan.expectedWorkMode,
        availableInputSources: buildAutonomousDesignBriefInputSources({
            params: input.params,
            context: input.context,
            runtimeContractBundle: input.runtimeContractBundle
        }),
        deliveryOutputs: artifactContract.deliveryOutputs,
        productionObligation: artifactContract.productionObligation,
        exitCriteria: artifactContract.exitCriteria
    });
    return {
        artifactContract,
        bindingContext,
        contextItem: buildAgenticRuntimeBindingContextItem(bindingContext)
    };
}

function buildBaseSystemPrompt(params: Record<string, any>, context?: any): string {
    const lines: string[] = [
        buildAgentOperatingProfilePromptSection(),
        '先判断用户要的是回答、文档或资源操作，还是视觉设计。只有视觉设计任务才从视觉层级、构图、产品真实性、排版、色彩、可读性和转化目标出发判断。',
        '所有用户可见内容与 provider-visible reasoning_content 必须使用简洁的简体中文（Simplified Chinese）。',
        '不要向用户讲内部系统、能力装载、工具名、路由、门禁、轮次或调试过程。受阻时，只说明还缺什么、会影响什么设计决定，以及接下来能怎么处理。',
        '理解目标后按结果风险与信息增益取得足够证据：规格化生产有唯一答案时走最短确定路径；开放创意以成品质量为先，首个安全可执行方案只是候选，不强迫所有任务经过同一套固定流程。',
        '优先可逆、非破坏性的做法，不得臆造文档状态、项目文件或已经完成的结果。',
        '用户可见过程只保留有价值的设计判断，例如主体比例、构图、留白、文字层级和色彩关系，不逐条播报操作。',
        '最终回复只说明当前做出了什么、效果到哪一步和还需要什么；没有做完就如实说，不输出工程诊断或验收报告。',
        '文字回复会结束本轮：如果你声称接下来会行动，就必须在同一响应提交真实动作；纯问答则直接给完整答案，不要为了满足这条规则调用工具。',
        AGENT_RESPONSE_PRESENTATION_PROMPT
    ];
    return lines.join('\n');
}

function buildBaseCapabilityPolicyPrompt(params: Record<string, any>, context?: any): string {
    return [
        '从当前可用的 Skill 和编辑操作中选择最适合下一步的动作，不预设固定角色顺序或统一业务流程。',
        '只查看当前设计决定真正需要的项目或 Photoshop 内容；环境中能看到的事实先自己看，只有看不到、读取失败、仍有真实歧义，或选择会改变用户独有事实时才提问。',
        '切换文档后先确认当前文档；修改图层时只使用刚刚读取或创建得到的对象，不猜图层编号。',
        '文字图层的图层名称和画面文字是两件事。用户说“A 改成 B”但没有说改哪一项时，先看哪一项实际等于 A；两者都符合或都不符合时，只问一个简短问题。',
        '项目资源没有定位到时先定向查找；存在多个可能目标或有覆盖风险时再请用户决定。',
        '完成一组相关修改后先查看结构是否正确；只有构图、排版、遮挡、可读性或整体观感需要判断时才看更新后的画面，不为每个小动作重复截图。',
        '过程面板是简洁的设计进展，不是操作日志；每个阶段只保留一个有意义的设计判断。',
        '图层属性和文字数值可以确认改动是否落在正确位置，但画面是否好看仍要以当前视觉效果为准。',
        buildDesignerAgentAutonomyPrinciplesPromptSection({
            hasPhotoshopDocument: resolveCurrentPhotoshopDocumentPresence(context)
        })
    ].filter(Boolean).join('\n');
}

function listManifestOwnedSkillCapabilityIds(): string[] {
    return Array.from(new Set(
        listSkillManifests().flatMap((manifest) => (
            [
                ...(manifest.legacy_skill_ids || []),
                ...(manifest.workflow_entry_skill_ids || [])
            ].map((skillId) => `skill.${skillId}`)
        ))
    ));
}

function isManifestOwnedSkill(skillId: string): boolean {
    return listManifestOwnedSkillCapabilityIds().includes(`skill.${skillId}`);
}

function isGenericBlockingInteractionTool(toolName: string): boolean {
    return toolName === 'askUserToChoose' || toolName === 'createInteractiveCard';
}

function requiresResolvedInteractionOwner(params?: Record<string, any>): boolean {
    const controlPlane = params?.agentIntentControlPlane as Partial<AgentIntentControlPlaneDecision> | undefined;
    return controlPlane?.toolScope === 'write_photoshop'
        && controlPlane.executionAuthorization === 'confirmed_tool_required';
}

function buildUnresolvedInteractionOwnerMessage(params?: Record<string, any>): string {
    const recommendation = isSkillRoutingRecommendation(params?.skillRoutingRecommendation)
        ? params?.skillRoutingRecommendation
        : undefined;
    const candidateTaskType = recommendation
        ? findManifestTaskTypeForSkill(recommendation.skillId)
        : undefined;
    if (candidateTaskType && recommendation) {
        const skill = getSkillById(recommendation.skillId);
        return [
            '这项设计需要由明确的专业工作方式负责，通用表单不能代替它。',
            `系统已提供候选能力「${skill?.displayName || recommendation.skillId}」。请先判断它是否与用户委托相符：相符就使用该能力继续；不相符就用当前原子工具自主推进。`,
            '只有确实需要用户决定、并且无法从素材或现场观察得到的信息，才应暂停询问。'
        ].join(' ');
    }
    return '这项设计尚未选择明确的专业工作方式，通用表单不能代替业务能力。若当前工具中已有匹配能力，请直接使用；否则用现有原子工具自主推进。只有无法观察、且不同答案会实质改变结果的信息，才应暂停询问用户。';
}

function resolveRuntimeInteractionTaskType(
    capabilitySession?: AgentCapabilitySession,
    params?: Record<string, any>
): string {
    const manifestTaskType = String(
        capabilitySession?.getResolution().manifestRef?.taskType || ''
    ).trim();
    if (manifestTaskType) return manifestTaskType;
    return String(params?.declaredTaskType || '').trim();
}

function resolveProviderOwnedInteractionSkillIds(
    capabilitySession?: AgentCapabilitySession,
    params?: Record<string, any>
): string[] {
    const ownerIds = new Set<string>();
    const manifestRef = capabilitySession?.getResolution().manifestRef;
    const taskType = resolveRuntimeInteractionTaskType(capabilitySession, params);
    const manifest = listSkillManifests().find((item) => (
        manifestRef
            ? (
            item.skill_id === manifestRef.skillId
            && item.task_type === manifestRef.taskType
            && item.version === manifestRef.version
            )
            : item.task_type === taskType || (item.task_type_variants || []).includes(taskType)
    ));
    if (manifest) {
        [
            ...(manifest.workflow_entry_skill_ids || []),
            ...(manifest.legacy_skill_ids || [])
        ].forEach((skillId) => {
            if (isSkillProviderInteractionOwner(skillId)) ownerIds.add(skillId);
        });
    }
    return Array.from(ownerIds);
}

/**
 * 未绑定工作流时给模型完整的 Manifest 菜单，而不是由 Harness 根据关键词替它选。
 * agentic Manifest 提供专业知识、预算和验收口径，设计判断仍留在自主循环；staged
 * Manifest 才提供规格化生产阶段。两类都必须先让模型看见，才能由它理解任务后绑定。
 */
function buildWorkflowMenuLines(): string[] {
    const items = listSkillManifests()
        .map((manifest) => {
            const entrySkillId = (manifest.workflow_entry_skill_ids || [])[0] || (manifest.legacy_skill_ids || [])[0];
            const entrySkill = entrySkillId ? getSkillById(entrySkillId) : undefined;
            const whenToUse = Array.isArray(entrySkill?.whenToUse) ? String(entrySkill?.whenToUse[0] || '').trim() : '';
            // Task Profile 是任务语义与交付角色的唯一 crosswalk。模型在首次选择 Profile
            // 的同一回合就必须先看到该语义，不能等绑定后才由 Method / Evaluation 补课；
            // legacy whenToUse 仅供尚未登记 Task Profile 的兼容 Manifest 降级使用。
            const taskProfileGuidance = String(
                getDesignTaskTypeSpec(manifest.task_type)?.declarationGuidance || ''
            ).trim();
            const declarationGuidance = taskProfileGuidance || whenToUse;
            const label = String(manifest.display_name || manifest.skill_id || '').trim();
            if (!label || !manifest.task_type) return '';
            const executionMeaning = manifest.execution_model === 'agentic'
                ? '开放创意：绑定专业方法后仍由你自主设计'
                : '规格化生产：绑定后按可验证阶段执行';
            return `  · ${label}（Profile：${manifest.task_type}；${executionMeaning}）${declarationGuidance ? `——${declarationGuidance.slice(0, 420)}` : ''}`;
        })
        .filter(Boolean);
    if (items.length === 0) return [];
    return [
        '可选的专业工作方法：先由你判断当前明确委托的交付物是否匹配。当前工具列表已有匹配 Skill 时直接调用 Skill。只有系统在下方明确给出对应 Profile、且当前工具列表没有匹配 Skill 时，才在首次专业写入前调用 declareDesignIntent({ taskTypeId: <Profile> }) 记录并绑定你自己的判断，不要绕过后再以通用流程冒充该交付物已完成。绑定只提供方法、能力范围、预算和验收口径，不替你决定素材、构图、文案或审美；只是提问、查看或把该领域当来源素材时不要绑定。',
        ...items
    ];
}

/** 候选工作流对应的 Runtime Profile（task_type）：给模型一个可直接绑定的 id，而不是抽象的「结构化设计意图」。 */
function findManifestTaskTypeForSkill(skillId: string): string | undefined {
    const normalized = String(skillId || '').trim();
    if (!normalized) return undefined;
    const manifest = listSkillManifests().find((item) => (
        (item.legacy_skill_ids || []).includes(normalized)
        || (item.workflow_entry_skill_ids || []).includes(normalized)
    ));
    return manifest?.task_type ? String(manifest.task_type) : undefined;
}

function buildBaseRuntimeContext(params: Record<string, any>, context?: any): string {
    const lines: string[] = [];
    if (areSkillBridgesForbidden(params)) {
        lines.push(
            '用户不希望使用专业 Skill。',
            '- 不要重新选择或请求 Skill；你仍然是任务决策者，可以按需检索并使用原子能力，自主完成观察、设计、写入、读回和交付。',
            '- Skill 或知识库不是你具备通用专业能力的来源；没有命中时使用模型已有知识冷启动，但当前项目事实仍以真实观察和工具读回为准。',
            '- 不得因为没有 Skill 就只给方案或把可逆专业判断抛给用户；同样以真实产物和读回证据判断完成。'
        );
    }
    const deniedToolDomains = Array.isArray(params.agentCapabilityConstraint?.deniedToolDomains)
        ? params.agentCapabilityConstraint.deniedToolDomains
        : [];
    if (deniedToolDomains.includes('photoshop')) {
        lines.push(
            '用户能力约束：本轮禁止调用需要 Photoshop 连接的 Tool；仍可使用当前开放的知识、项目或外部能力。'
        );
    }
    const deniedProviderToolNames = Array.isArray(params.agentCapabilityConstraint?.deniedProviderToolNames)
        ? params.agentCapabilityConstraint.deniedProviderToolNames
            .map((name: unknown) => String(name || '').trim())
            .filter(Boolean)
            .slice(0, 12)
        : [];
    if (deniedProviderToolNames.length > 0) {
        lines.push(`用户明确禁用的能力：${deniedProviderToolNames.join(', ')}。不要重新请求这些能力。`);
    }
    const selectedSkillHandoff = validateRuntimeSelectedSkillHandoff(params.runtimeSelectedSkillHandoff)
        ? params.runtimeSelectedSkillHandoff
        : undefined;
    const skillRoutingRecommendation = isSkillRoutingRecommendation(params.skillRoutingRecommendation)
        ? params.skillRoutingRecommendation
        : undefined;
    const designDocumentRoleContext = buildDesignDocumentRoleContext({
        userInput: getAutonomousTaskText(params, context),
        currentDocumentName: resolveCurrentPhotoshopDocumentName(context),
        hasCurrentDocument: resolveCurrentPhotoshopDocumentPresence(context) === true,
        workMode: normalizeRuntimeDesignWorkMode(params?.declaredWorkMode)
    });
    if (selectedSkillHandoff) {
        lines.push(
            `当前任务已经选用专业工作方法「${selectedSkillHandoff.skillId}」。`,
            '- 规则明确的生产步骤优先交给它；项目事实、视觉判断和局部设计修正仍由你负责。',
            '- 它受阻或当前稿件需要修正时，使用现在可用的可逆编辑继续处理，再回到原任务。'
        );
    }
    // 意图理解交给模型：没有 Runtime owner 时，把全部 Manifest 菜单给它自己选。
    // 如果只列 staged，agentic 交付物在 canonical 正则未命中时会被 Harness 隐身，
    // 模型只能退化成通用工具循环，既拿不到专业方法也拿不到正确交付契约。
    if (!selectedSkillHandoff && !areSkillBridgesForbidden(params) && !params?.declaredTaskType) {
        lines.push(...buildWorkflowMenuLines());
    }
    if (
        skillRoutingRecommendation
        && !areSkillBridgesForbidden(params)
    ) {
        const recommendedSkill = getSkillById(skillRoutingRecommendation.skillId);
        const recommendationRequiresRuntimeOwner = isManifestOwnedSkill(
            skillRoutingRecommendation.skillId
        );
        if (recommendationRequiresRuntimeOwner && !selectedSkillHandoff) {
            // recommendation 只提供候选身份：若 Skill 已在当前工具列表中，模型直接调用；只有
            // 系统给出了精确 Profile 且 Skill 不可见时，才允许用 declareDesignIntent 原地绑定。
            const candidateTaskType = findManifestTaskTypeForSkill(skillRoutingRecommendation.skillId);
            lines.push(
                `候选工作流是「${recommendedSkill?.displayName || skillRoutingRecommendation.skillId}」${candidateTaskType ? `（Profile：${candidateTaskType}）` : ''}。`,
                candidateTaskType
                    ? `- 如果用户要的就是这类交付物：当前工具列表已有匹配 Skill 就直接调用；只有没有匹配 Skill 时，才使用系统给出的 Profile 调用 declareDesignIntent({ taskTypeId: "${candidateTaskType}" }) 原地绑定。任务身份未绑定前，不要创建阻塞式通用卡片或申请该领域的内部原子能力。`
                    : '- 如果它确实拥有当前交付物且当前工具列表已有匹配 Skill，直接调用 Skill；没有系统明确给出的 Profile 时不要自行调用 declareDesignIntent。',
                '- 如果用户要的只是把它当来源素材或并不匹配，就忽略这项建议，用当前普通设计能力继续完成，不要停在只读调查。'
            );
        } else {
            lines.push(
                `当前任务可能适合「${recommendedSkill?.displayName || skillRoutingRecommendation.skillId}」。`,
                '- 先确认它与用户真正要做的事相符；相符就直接使用，并带上已经确认的素材和约束，不重复规划它内部的工作。',
                '- 只查看它开始工作真正缺少的内容；没有实际歧义时不要先创建确认卡。',
                '- 如果并不匹配，就忽略这项建议，改用当前可用的普通设计操作自行完成。'
            );
        }
    }
    const internalResumeRequest = params.internalResumeRequest;
    if (
        internalResumeRequest?.version === 'agent-internal-resume/v0'
        && typeof internalResumeRequest.resolutionSummary === 'string'
    ) {
        lines.push(
            '上次暂停任务的当前状态：',
            `- ${internalResumeRequest.resolutionSummary}`,
            '- 从暂停位置继续，先核对必要的当前内容，不重复已经确认、取消或做过的动作，也不要重新创建同一张确认卡。'
        );
    }
    // 文档角色来自词法和文件名，只作为规划提示；真正的写入目标由 Runtime 身份、
    // documentId/revision 与用户显式指令共同确定。
    const hasCurrentDocument = designDocumentRoleContext.currentDocumentUse !== 'none';
    if (designDocumentRoleContext.targetRole !== 'unknown'
        || designDocumentRoleContext.currentRole !== 'unknown'
        || hasCurrentDocument) {
        lines.push('当前文档提示：', designDocumentRoleContext.agentInstruction);
    }
    return lines.join('\n');
}

function buildDynamicDesignTaskOperatingContext(
    params: Record<string, any>,
    context?: any
): string {
    const taskGroundingRules = [
        '【和用户沟通】',
        '- 只有关键取舍能帮助用户理解结果，或确实需要用户拍板时才说明；沟通与执行互不授权。',
        '- 面向用户不要出现工具名、英文标识、阶段编号、状态码或任何系统术语；不逐条播报搜索、读取、坐标计算或原子动作。',
        '【把设计做出来】',
        '- 先把当前指令、有界历史对话和实时项目事实合并成一个具体交付目标，再决定需要哪些观察；同一会话里已经明确且尚未完成的交付物，应先核对当前目标后续接，不要重新从项目中漫无目的猜任务。',
        '- 如果当前短指令只有品类名称，且历史对话或项目事实已经唯一确定交付物，就直接承接；仍不能唯一确定交付物时，只问一个决定执行方向的简短问题，不要用反复搜索素材代替任务澄清。',
        '- 当前目标文档、必要图层结构和画面已经足够支撑下一步时，停止重复读取并开始实际制作；只有一个会实质改变方向的用户决定仍不明确时才提问。',
        buildDesignerDecisionOwnershipPromptSection()
    ].join('\n');
    const taskTypeId = String(params?.declaredTaskType || '').trim();
    const spec = getDesignTaskTypeSpec(taskTypeId);
    if (!spec) {
        return [
            '【自适应设计决策】',
            '按结果风险与信息增益取得足够证据，不把所有设计任务塞进固定流水线：',
            '- 先锁定具体交付物、目标对象和用户硬约束；上下文已经唯一确定时直接承接，不重复做需求分析。',
            '- 只观察会影响设计判断的事实。简单局部修改通常只需目标文档与对象属性；正式开放创意则要取得足以理解对象、用途、受众、素材角色与视觉机会的证据，不能把一张安全可用的候选图当成完整理解。',
            '- 人群、卖点、痛点和营销文案不是所有视觉任务的默认必填项。纯排版、无文字视觉、白底产品图、既有稿局部调整等任务按真实交付需要决定。',
            '- 参考检索按信息增益触发：陌生对象、缺乏可靠视觉基准或方向仍停留在泛化词时，应主动寻找能区分方向的证据；已有证据足以支撑有品质的判断时可以不查。是否使用 Eagle 或其他参考由你决定，不把任何来源变成固定前置。',
            '- 首稿可执行不等于完成。开放创意在正式交付前要挑战首个安全方案：判断是否还有一个关键关系、相关参考或批评能显著改善结果，必要时做有界迭代；没有新证据时不为凑步骤反复改稿。',
            '- 修改后确认目标、属性、层级与真实视觉效果；在首稿、关键视觉变化和最终判断等有意义的时点看新画面，不要为每个小动作重复截图，也不强制调用某个评价工具。',
            '信息不齐时先做能确定的部分，并说清楚缺什么：项目里查得到的自己查（素材、既有设计、图层结构、规格），只有用户才知道的才问（预算、品牌硬性规范、必须保留的元素、最终取舍）。',
            '先判断当前任务是否匹配已注册 Skill：匹配就直接使用；不匹配就自己规划，并使用当前可用的设计操作完成。',
            taskGroundingRules
        ].join('\n');
    }
    const projectContext = context?.projectContext || {};
    const projectAssetCount = Number(
        projectContext.projectImageCount
        || projectContext.assetIndex?.summary?.totalImages
        || projectContext.resources?.length
        || 0
    );
    return [
        buildDesignTaskTypePromptSection(spec, {
            hasPhotoshopDocument: resolveCurrentPhotoshopDocumentPresence(context) === true,
            hasProjectAssets: Number.isFinite(projectAssetCount) && projectAssetCount > 0,
            hasEagle: projectContext.hasEagle === true || context?.eagleAvailable === true
        }),
        taskGroundingRules
    ].join('\n\n');
}

export function buildDesignPrinciplesRuntimeContext(
    designDisciplineActive: boolean,
    detail: 'compact' | 'full' = 'full'
): string {
    const useFullFoundation = designDisciplineActive && detail === 'full';
    const principles = useFullFoundation
        ? buildDesignPrinciplesSummary('all')
        : [
            buildDesignPrinciplesSummary('overview'),
            buildDesignPrinciplesSummary('self-check')
        ].filter(Boolean).join('\n\n');
    if (!designDisciplineActive) return principles;
    return [
        principles,
        '### 设计落地',
        '- 只有需要精确复现参考构图时才测量比例；没有合适参考时，依据当前画布、组件边界和设计原则继续。',
        '- 开放创意中的首稿是可检验的视觉假设，不是完成声明；正式成品应按结果风险挑战首个安全方案，必要时借助相关参考、批评或有界迭代改善关键关系。',
        '- 局部编辑先看清目标容器和相对关系；当前方法失败时立即换用其他可逆方法，不要反复重试同一动作。',
        '- 数值和图层结构正确不代表画面一定好看。涉及构图、排版和整体观感时看更新后的画面；导航、命名、显隐等结构调整无需频繁截图。'
    ].join('\n\n');
}

/**
 * 为一个已验证 Runtime Bundle 编译阶段化上下文。
 * 启动绑定与循环内声明绑定共用同一函数；动态绑定不会回补通用 TaskContext，只消费
 * Manifest 治理知识、Artifact 知识、工艺 Recipe 与设计原理。
 */
function buildRuntimeStageContextItemsForBundle(input: {
    runtimeContractBundle: AgentTaskRuntimeContractBundle;
    designDisciplineActive: boolean;
    requestedArtifactId?: unknown;
    taskContextItem?: RuntimeContextItem | null;
    designMethodKnowledge?: ReturnType<typeof buildDesignMethodKnowledgeRuntimeContext>;
    /**
     * agentic 执行模型没有 Stage，任务方法与交付语义从第一轮可见；通用设计原则只给
     * 紧凑底座，深层构图、字体与工艺知识继续按当前问题检索。实现上去掉
     * applicableStages，让无 stage 的任务保留这些已选项，而不是注入整本知识库。
     */
    stageAgnostic?: boolean;
}): RuntimeContextItem[] {
    const designMethodKnowledge = input.designMethodKnowledge
        || buildDesignMethodKnowledgeRuntimeContext({
            knowledgeRefs: input.runtimeContractBundle.manifest.knowledge_refs || [],
            manifestSkillId: input.runtimeContractBundle.manifest.skill_id
        });
    if (designMethodKnowledge.issues.length > 0) {
        throw new Error(`runtime_design_method_knowledge_invalid:${designMethodKnowledge.issues.join(',')}`);
    }
    const knowledgeTaskType = input.runtimeContractBundle.artifactManifest?.task_type
        || input.runtimeContractBundle.manifest.task_type;
    const artifactKnowledgeItem = buildDesignArtifactKnowledgeRuntimeItem({
        taskTypeId: knowledgeTaskType,
        manifestSkillId: input.runtimeContractBundle.artifactManifest?.skill_id
            || input.runtimeContractBundle.manifest.skill_id,
        requestedArtifactId: input.requestedArtifactId
    });
    const photoshopCraftRecipeItems = buildPhotoshopCraftRecipeRuntimeItems({
        taskTypeId: knowledgeTaskType
    });
    const designPrinciplesItem: RuntimeContextItem = {
        id: 'knowledge.design-principles',
        kind: 'knowledge',
        source: 'design-principles-foundation',
        trust: 'governed_knowledge',
        slot: 'knowledge_context',
        content: buildDesignPrinciplesRuntimeContext(
            input.designDisciplineActive,
            input.stageAgnostic ? 'compact' : 'full'
        ),
        applicableStages: ['R3', 'R4', 'R5'],
        priority: 90,
        freshness: 'current'
    };
    const stagedItems: RuntimeContextItem[] = [
        ...designMethodKnowledge.items,
        ...(artifactKnowledgeItem ? [artifactKnowledgeItem] : []),
        ...photoshopCraftRecipeItems,
        designPrinciplesItem,
        ...(input.taskContextItem ? [input.taskContextItem] : [])
    ];
    const rawItems: RuntimeContextItem[] = input.stageAgnostic
        ? stagedItems.map(({ applicableStages: _applicableStages, ...item }) => item)
        : stagedItems;
    const validation = compileRuntimeContext({ items: rawItems });
    if (validation.issues.length > 0) {
        console.warn('[RuntimeContext] 无效的阶段化知识项已降级忽略：', validation.issues);
    }
    const rejectedItemIds = new Set(validation.rejectedItemIds);
    return rawItems.filter((item) => !rejectedItemIds.has(item.id));
}

/**
 * 普通自然语言设计请求尚未声明精确 Profile 时，仍给模型一份通用、受治理的专业知识底座。
 * 这不是隐式任务分类，也不建立 Stage、裁剪工具面或授予写入权限；Agent 仍自行判断交付物、
 * 参考价值、设计方向和工作方法。循环内声明精确 agentic Profile 后，这组通用项会被对应
 * Manifest 知识原位替换。
 */
function buildPlanNeutralDesignKnowledgeRuntimeItems(input: {
    designDisciplineActive: boolean;
}): RuntimeContextItem[] {
    if (!input.designDisciplineActive) return [];

    const designerJudgmentSummary: RuntimeContextItem = {
        id: 'knowledge.plan-neutral-designer-judgment',
        kind: 'knowledge',
        source: 'plan-neutral-designer-judgment-summary',
        trust: 'governed_knowledge',
        slot: 'knowledge_context',
        content: [
            '## 成熟设计师判断摘要（计划中立）',
            buildDesignPrinciplesSummary('overview'),
            '- 这些是可组合的判断维度，不是开工表单：结合当前目标理解对象、用途、受众、素材角色、可靠事实与关键未知。候选短名单只比较某个角色的适配度，不等于对象理解。',
            '- 只补充会改变概念、选材或表达的证据。是否扩大项目观察、检索 Eagle 或查其他参考，由你按信息增益决定；陌生对象或缺乏可靠视觉基准时主动查，证据足以区分并支持有品质的方向时再收敛，不能因为已有一张安全素材就提前停止。',
            '- 用“观察证据 → 对受众或使用情境的意义 → 视觉关系”形成方向；事实、推断和设计选择分开表达，不把品类常识、文件名、旧稿文字或参考内容冒充当前事实。',
            '- 信息足以支持连贯方向时自主制作可逆首稿，但首稿可执行不等于完成；正式成品前要挑战首个安全方案，并按真实画面证据决定是否需要参考、批评或有界迭代。Harness 只执行、校验目标与读回事实，不替你选择构图、风格、素材或文案。',
            '- 不依赖 Skill 也可以使用当前原子能力完成设计。匹配现有 Skill 时直接调用；需要某个交付物方法或更深的构图、色彩、字体、工艺与复核原则时，按需调用 getDesignKnowledge 或 getDesignPrinciples，不要把全量知识当作每轮必读清单。'
        ].join('\n'),
        priority: 90,
        freshness: 'current'
    };
    const validation = compileRuntimeContext({ items: [designerJudgmentSummary] });
    if (validation.issues.length > 0) {
        console.warn('[RuntimeContext] 无效的 plan-neutral 设计知识项已降级忽略：', validation.issues);
    }
    const rejectedItemIds = new Set(validation.rejectedItemIds);
    return [designerJudgmentSummary].filter((item) => !rejectedItemIds.has(item.id));
}

export interface AutonomousCapabilityRuntime {
    /** staged 执行模型：Stage 机 + 写入门禁 + manifest 裁剪工具面（规格化生产任务）。 */
    runtimeContractBundle?: AgentTaskRuntimeContractBundle;
    /**
     * agentic 执行模型解析到的清单：**只**供知识注入、预算画像与任务类型识别，
     * 不建立 Runtime Session / Stage 机，不作为写入门票，工具面走 broad discovery。
     */
    agenticManifestBundle?: AgentTaskRuntimeContractBundle;
    capabilitySession: AgentCapabilitySession;
    runtimeContractStatus: RuntimeContractStatus;
}

function areSkillBridgesForbidden(params?: Record<string, any>): boolean {
    if (!params) return false;
    if (params.skillBridgePolicy === 'forbid') return true;
    const deniedKinds = params.agentCapabilityConstraint?.deniedCapabilityKinds;
    return Array.isArray(deniedKinds) && deniedKinds.includes('skill');
}

function normalizeRuntimeWriteToolAllowlist(params: Record<string, any>): string[] | undefined {
    if (!Array.isArray(params.runtimeAllowedWriteTools)) return undefined;
    return Array.from(new Set(
        params.runtimeAllowedWriteTools
            .map((toolName: unknown) => String(toolName || '').trim())
            .filter(Boolean)
    ));
}

function readRuntimeExactPropertyScope(
    params: Record<string, any>
): ExactPropertyExecutionScope | undefined {
    const value = params.runtimeExactPropertyScope;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, any>;
    const replacement = record.replacement;
    if (record.version !== 'exact-property-execution-scope/v0'
        || record.kind !== 'exact_property_replacement'
        || !replacement
        || typeof replacement.from !== 'string'
        || typeof replacement.to !== 'string'
        || !['layer_name', 'text_content', 'unspecified'].includes(replacement.hint)
        || !Array.isArray(record.allowedWriteTools)) {
        return undefined;
    }
    const allowedWriteTools = record.allowedWriteTools.filter(
        (toolName: unknown) => toolName === 'renameLayer' || toolName === 'setTextContent'
    );
    if (allowedWriteTools.length === 0) return undefined;
    return {
        version: 'exact-property-execution-scope/v0',
        kind: 'exact_property_replacement',
        replacement: {
            from: replacement.from,
            to: replacement.to,
            hint: replacement.hint
        },
        allowedWriteTools
    };
}

function validateRuntimeExecutionScope(
    bundle: AgentTaskRuntimeContractBundle | undefined,
    params: Record<string, any>
): RuntimeManifestBindingResult {
    const workMode = bundle?.stagePlan.expectedWorkMode;
    const executionScopeKind = workMode
        ? bundle?.stagePlan.workModeContracts?.[workMode]?.execution_scope_kind
        : undefined;
    const exactScope = readRuntimeExactPropertyScope(params);
    const decision = evaluateScopedEditExecutionScope({
        executionScopeKind,
        ...(exactScope ? { exactPropertyScope: exactScope } : {})
    });
    return decision.status === 'ready'
        ? { success: true }
        : {
            success: false,
            code: decision.code,
            error: decision.reason
        };
}

function filterRuntimeCandidateTools(
    candidateTools: ToolSchema[],
    runtimeWriteToolAllowlist: string[] | undefined,
    exactPropertyScope?: ExactPropertyExecutionScope
): ToolSchema[] {
    if (!runtimeWriteToolAllowlist && !exactPropertyScope) return candidateTools;
    const allowedWriteTools = new Set(runtimeWriteToolAllowlist || []);
    const exactContextTools = new Set(EXACT_PROPERTY_EXECUTION_CONTEXT_TOOLS);
    return candidateTools.filter((tool) => {
        if (exactPropertyScope) {
            if (isAgentHarnessControlTool(tool.name)) return true;
            if (allowedWriteTools.has(tool.name)) return true;
            return exactContextTools.has(tool.name);
        }
        const kind = classifyAgentToolExecution(tool.name);
        if (kind !== 'photoshop_write' && kind !== 'save_export') return true;
        return allowedWriteTools.has(tool.name);
    });
}

function isPhotoshopDomainProviderTool(
    toolName: string,
    workflowBridgeNames: ReadonlySet<string>,
    params: any = {},
    sourceDependentUnknownRequiresPhotoshop = true
): boolean {
    const semantics = getPhotoshopToolSkillSemantics(toolName, params);
    if (semantics) return semantics.requiresPhotoshopConnection === true;

    const skill = getSkillById(toolName);
    if (skill) {
        const requirements = skill.runtimeRequirements;
        if (!requirements || requirements.photoshop === 'required') return true;
        if (requirements.photoshop === 'not_required') return false;
        const sourceType = String(params?.sourceType || '').trim();
        if (!sourceType) return sourceDependentUnknownRequiresPhotoshop;
        return !requirements.photoshopFreeSourceTypes?.includes(sourceType);
    }

    if (!workflowBridgeNames.has(toolName)) return false;
    const kind = classifyAgentToolExecution(toolName);
    return kind === 'photoshop_write' || kind === 'save_export';
}

export function resolveAutonomousCapabilityRuntime(
    params: Record<string, any>,
    context?: any
): AutonomousCapabilityRuntime {
    const atomicTools = getDefaultAgentTools();
    const workflowBridgeTools = buildSkillToolSchemas();
    const workflowBridgeNames = new Set(workflowBridgeTools.map((tool) => tool.name));
    const providerToolDenyPolicy = buildAgentProviderToolDenyPolicy(params, workflowBridgeNames);
    const candidateTools = filterRuntimeCandidateTools([
        ...atomicTools,
        DELEGATE_TOOL,
        TEAM_PIPELINE_TOOL,
        ...workflowBridgeTools
    ], normalizeRuntimeWriteToolAllowlist(params), readRuntimeExactPropertyScope(params)).filter((tool) => (
        (!isAgentMattingPaused() || !isAgentMattingAtomicTool(tool.name))
        // 恢复点是宿主容错机制，不是 Agent 的设计或交付选择；UI 仍可直接调用它。
        && !AGENT_INTERNAL_PROVIDER_TOOL_NAMES.has(tool.name)
        // source-dependent Skill 在可见性阶段保持开放；真正调用时再依据 sourceType
        // 执行 deny-wins。未知来源不是“不支持”，不能提前折成 Photoshop 依赖。
        && !resolveAgentProviderToolDenyMatch(providerToolDenyPolicy, tool.name, {}, 'visibility')
    ));
    // Capability 选择只采信真正的结构化声明。设计纪律仍可在 Policy 层读取旧任务文本，
    // 但其正则迁移逻辑不得回流到 Resolver，否则自然语言会再次形成品类 manifest 牢笼。
    const rawHandoff = params?.runtimeSelectedSkillHandoff;
    const runtimeSelectedSkillHandoff: RuntimeSelectedSkillHandoff | undefined = (
        validateRuntimeSelectedSkillHandoff(rawHandoff) ? rawHandoff : undefined
    );
    const rawRunResumeContractBinding = params?.runtimeResumeContractBinding;
    const runResumeContractBinding = validateRunResumeContractBinding(rawRunResumeContractBinding)
        ? rawRunResumeContractBinding
        : undefined;
    const runResumeBindingInvalid = rawRunResumeContractBinding !== undefined
        && !runResumeContractBinding;
    const explicitStructuredTaskType = String(params?.declaredTaskType || '').trim() || undefined;
    const structuredTaskType = explicitStructuredTaskType
        || runResumeContractBinding?.selectedTaskType
        || undefined;
    const structuredWorkModeText = String(params?.declaredWorkMode || '').trim();
    const structuredWorkMode = normalizeRuntimeDesignWorkMode(structuredWorkModeText);
    const structuredWorkModeInvalid = Boolean(structuredWorkModeText && !structuredWorkMode);
    const explicitStructuredSkillId = String(params?.declaredSkillId || '').trim() || undefined;
    const handoffInvalid = rawHandoff !== undefined && !runtimeSelectedSkillHandoff;
    const handoffConflictsWithDeclaration = Boolean(
        runtimeSelectedSkillHandoff
        && explicitStructuredSkillId
        && runtimeSelectedSkillHandoff.skillId !== explicitStructuredSkillId
    );
    const resumeBindingConflictsWithDeclaration = Boolean(
        runResumeContractBinding
        && (
            (explicitStructuredTaskType
                && runResumeContractBinding.selectedTaskType
                && explicitStructuredTaskType !== runResumeContractBinding.selectedTaskType)
            || (explicitStructuredSkillId
                && runResumeContractBinding.selectedSkillId
                && explicitStructuredSkillId !== runResumeContractBinding.selectedSkillId)
            || (runtimeSelectedSkillHandoff
                && runResumeContractBinding.selectedSkillId
                && runtimeSelectedSkillHandoff.skillId !== runResumeContractBinding.selectedSkillId)
        )
    );
    const structuredSkillId = runtimeSelectedSkillHandoff?.skillId
        || explicitStructuredSkillId
        || runResumeContractBinding?.selectedSkillId
        || undefined;
    const resolvedContractCandidate = handoffInvalid
        || handoffConflictsWithDeclaration
        || runResumeBindingInvalid
        || resumeBindingConflictsWithDeclaration
        || structuredWorkModeInvalid
        ? undefined
        : buildRuntimeContractBundleForAgentTask({
            taskType: structuredTaskType,
            skillId: structuredSkillId,
            ...(structuredWorkMode ? { workMode: structuredWorkMode } : {}),
            executableToolNames: candidateTools.map((tool) => tool.name)
        });
    const resumeManifestMismatch = Boolean(
        runResumeContractBinding
        && resolvedContractCandidate
        && resolvedContractCandidate.manifest.skill_id !== runResumeContractBinding.manifestSkillId
    );
    const resolvedContractBundle = resumeManifestMismatch
        ? undefined
        : resolvedContractCandidate;
    // 设计路径宪法：agentic 清单不进 Stage 机——它只留给知识/预算/任务类型识别，
    // 工具面与写入权限走 broad discovery + 执行点真红线（与 manifest 未命中时完全同一条路）。
    const agenticExecution = isAgenticExecutionModel(resolvedContractBundle?.manifest);
    const runtimeContractBundle = agenticExecution ? undefined : resolvedContractBundle;
    const agenticManifestBundle = agenticExecution ? resolvedContractBundle : undefined;
    let runtimeContractSelectionSource: RuntimeContractStatus['selectionSource'];
    if (runtimeSelectedSkillHandoff?.source) {
        runtimeContractSelectionSource = runtimeSelectedSkillHandoff.source;
    } else if (explicitStructuredSkillId || explicitStructuredTaskType) {
        runtimeContractSelectionSource = 'explicit_runtime_declaration';
    } else if (runResumeContractBinding) {
        runtimeContractSelectionSource = 'structured_run_resume';
    }
    const runtimeContractStatus = buildRuntimeContractStatus({
        selectedSkillId: structuredSkillId,
        selectedTaskType: structuredTaskType,
        manifestSkillId: resolvedContractBundle?.manifest.skill_id,
        selectionSource: runtimeContractSelectionSource,
        selectionExpected: rawHandoff !== undefined
            || rawRunResumeContractBinding !== undefined
            || Boolean(structuredSkillId || structuredTaskType)
    });
    const intentControlPlane = params.agentIntentControlPlane as Partial<AgentIntentControlPlaneDecision> | undefined;
    // 基础设计手艺的可见性由结构化执行委托决定，不等模型先猜中品类或声明 Profile。
    // 这里只增加模型可见 schema；Tool preflight、目标一致性和 revision 仍是实际写入
    // 安全 owner。
    const designExecutionCapabilityBaselineRequested = intentControlPlane?.toolScope === 'write_photoshop'
        && intentControlPlane.executionAuthorization === 'confirmed_tool_required';
    const skillRoutingRecommendation = isSkillRoutingRecommendation(params.skillRoutingRecommendation)
        ? params.skillRoutingRecommendation
        : undefined;
    const manifestRequiredCapabilityIds = listManifestOwnedSkillCapabilityIds();
    const recommendationRequiresRuntimeOwner = Boolean(
        skillRoutingRecommendation
        && manifestRequiredCapabilityIds.includes(skillRoutingRecommendation.capabilityId)
    );
    const exposeSkillRoutingRecommendation = Boolean(
        skillRoutingRecommendation
        && !recommendationRequiresRuntimeOwner
        && intentControlPlane?.toolScope !== 'none'
        && candidateTools.some((tool) => tool.name === skillRoutingRecommendation.skillId)
    );
    const useRecommendedSkillFastPath = Boolean(
        skillRoutingRecommendation
        && exposeSkillRoutingRecommendation
        && !runtimeContractBundle
        && !areSkillBridgesForbidden(params)
    );
    let baselineCapabilityIds: string[];
    if (useRecommendedSkillFastPath && skillRoutingRecommendation) {
        baselineCapabilityIds = buildRecommendedSkillFastPathBaseline(
            skillRoutingRecommendation.capabilityId
        );
    } else {
        baselineCapabilityIds = [
            ...buildAgentCapabilityBaseline(
                resolveAutonomousDesignDisciplineContext(params, context).active
                    || designExecutionCapabilityBaselineRequested
            ),
            // R0 已绑定 Runtime owner 的技能直接进首轮 schema：绑定即系统确认，
            // 让模型再花两轮 search+request 申请它是纯开销（2026-08-23 时间账本：约 40-60s/次运行）。
            // 仍只是可见性，不授权执行；未绑定 manifest 时业务技能保持按需目录不变。
            ...(runtimeContractBundle?.manifest?.skill_id
                ? [`skill.${runtimeContractBundle.manifest.skill_id}`]
                : []),
            ...(
                skillRoutingRecommendation && exposeSkillRoutingRecommendation
                    ? [skillRoutingRecommendation.capabilityId]
                    : []
            )
        ];
    }
    const capabilitySession = createAgentCapabilitySession({
        candidateTools,
        workflowBridgeNames: workflowBridgeTools.map((tool) => tool.name),
        // agentic 清单不参与工具面裁剪：requestedTaskType 也不传，避免 resolver 记一条
        // 「结构化任务类型未注册」的误导性 issue（清单其实已解析，只是刻意不绑）。
        requestedTaskType: agenticExecution ? undefined : structuredTaskType,
        manifest: runtimeContractBundle?.manifest,
        workMode: runtimeContractBundle?.stagePlan.expectedWorkMode,
        // Agentic 清单不裁剪 broad atomic Tool surface；只把当前清单显式声明的
        // workflow entry 作为 owner-only schema 加入同一 Capability Session。
        agenticOwnerManifest: agenticManifestBundle?.manifest,
        baselineCapabilityIds,
        // 声明了 canonical workflow owner 的业务 Skill 在 Manifest 绑定前一律不可按需激活。
        // 不能只封住“本轮恰好推荐的那一个”，否则模型可绕到另一个 legacy executor。
        manifestRequiredCapabilityIds,
        // 领域原子工具默认随 Runtime owner 绑定，不在 broad discovery 中泄漏业务旁路。
        // 用户明确禁用 Skill 时传空集合：裸 Agent 仍可按需装载同一批原子能力，
        // 这条旁路用于真实能力验证，不把 Skill 变成完成业务任务的硬依赖。
        manifestRequiredProviderToolNames: areSkillBridgesForbidden(params)
            ? []
            : getSkillInternalToolNames(),
        deniedCapabilityKinds: areSkillBridgesForbidden(params) ? ['skill'] : [],
        deniedProviderToolNames: Array.from(providerToolDenyPolicy.deniedProviderToolNames)
    });

    return {
        ...(runtimeContractBundle ? { runtimeContractBundle } : {}),
        ...(agenticManifestBundle ? { agenticManifestBundle } : {}),
        capabilitySession,
        runtimeContractStatus
    };
}

export function selectToolsForContext(params: Record<string, any>, context?: any): ToolSchema[] {
    return resolveAutonomousCapabilityRuntime(params, context).capabilitySession.activeTools;
}

function buildPrimaryAgentDispatchPlan(taskType: ConversationTaskType = 'logic') {
    try {
        const state = useAppStore.getState();
        const prefs = (state as any).modelPreferences;
        return buildMultimodalModelDispatchPlan({
            consumer: 'primary-agent',
            taskType,
            prefs,
            mode: prefs?.mode,
            includeFallback: false,
            includeCrossTaskBackups: false,
            requireToolUse: true,
        });
    } catch {
        return buildMultimodalModelDispatchPlan({
            consumer: 'primary-agent',
            taskType,
            requireToolUse: true
        });
    }
}

/**
 * 读取模型偏好（store 读取失败时返回 undefined，由调用方按「无配置」诚实处理，不静默兜底）。
 */
function readModelPreferencesSafe(): any {
    try {
        return (useAppStore.getState() as any).modelPreferences;
    } catch {
        return undefined;
    }
}

function findConfiguredModelInRendererState(modelId: string): ModelConfig | null {
    const knownModel = getModelById(modelId);
    if (knownModel) return knownModel;

    const dynamicModels = (useAppStore.getState() as any).dynamicModels;
    if (!Array.isArray(dynamicModels)) return null;
    return dynamicModels.find((model: ModelConfig) => model?.id === modelId) || null;
}

/**
 * 从用户配置的唯一 Agent 模型中读取本轮模型。
 * 只有当前目录明确声明 supportsVision=true 才能运行；未知不会按名称猜，也不会回退文本模型。
 */
function resolveUserConfiguredPrimaryModel(_taskType: ConversationTaskType): string {
    try {
        const prefs = readModelPreferencesSafe();
        const modelId = String(prefs?.primaryModel || '').trim();
        if (!modelId) return '';

        const model = findConfiguredModelInRendererState(modelId);
        if (!model || !isAgentMultimodalModelConfig(model)) return '';
        // 只有「有依据的否定」才拒绝这个模型；能力未知一律放行，交给真实调用去检验。
        // 旧写法把 supportsToolUse 直接与否定布尔值比较，将「provider 没声明」也当成确定不支持，
        // 于是用户在设置里选得到的模型在这里被判空，最终报 no_usable_model
        //（真机 2026-08-01：deepseek-v4-flash）。判据与铁律见 model-capability-verdict。
        const capabilityInput = {
            provider: model.provider,
            modelLabel: model.name || modelId
        };
        const toolVerdict = resolveToolUseVerdict({ ...capabilityInput, declared: model.supportsToolUse });
        if (capabilityBlocksExecution(toolVerdict)) return '';
        return modelId;
    } catch {
        return '';
    }
}

/**
 * 主 Agent 实际使用的模型 id 解析（单一不变量）：
 * - dispatch 已解析出已识别模型 → 直接用；
 * - dispatch 无法解析时只复核用户当前选择；
 * - 不读取 legacy visualModel，不跨 provider 自动 fallback。
 */
function resolvePrimaryAgentModelId(
    dispatchPlan: ReturnType<typeof buildPrimaryAgentDispatchPlan>,
    taskType: ConversationTaskType
): string {
    if (dispatchPlan.selectedModelId) return dispatchPlan.selectedModelId;
    return resolveUserConfiguredPrimaryModel(taskType);
}

function getModelId(taskType: ConversationTaskType = 'logic'): string {
    const dispatchPlan = buildPrimaryAgentDispatchPlan(taskType);
    return resolvePrimaryAgentModelId(dispatchPlan, taskType);
}

/**
 * 没有可用角色模型时，内部保留稳定错误码，用户只看到自然、可行动的说明。
 * 不向设计用户暴露任务槽、路由、候选队列或自动降级实现。
 */
function buildNoUsableModelResult(taskType: ConversationTaskType): AgentResult {
    const fallbackBoundary = '我没有擅自改用其他模型。';
    return {
        success: false,
        message: `当前选择的 Agent 模型尚未被运行时确认具备读图能力，或暂时无法连接，所以还没有开始处理画面。${fallbackBoundary}请在模型设置中改选已标记视觉能力的模型，并检查对应账户登录或 API Key。`,
        error: `no_usable_agent_model:${taskType}`
    };
}

/**
 * 工具循环思考开关：按用户「模型思考」偏好 + 模型能力（isModelThinkingUserControllable）解析
 * 当前主模型是否开启原生思考。与对话通道共用 resolveModelThinkingEnabledForCall，保证两条通道一致。
 */
function resolveAgentThinkingEnabled(modelId: string): boolean {
    try {
        const prefs = (useAppStore.getState() as any).modelPreferences;
        return resolveModelThinkingEnabledForCall(modelId, prefs);
    } catch {
        return false;
    }
}

/**
 * 用户在设置里选的推理档位。
 *
 * 只在**模型目录声明支持该档位**时返回，否则返回 undefined（= 不下发，保持上游默认）。
 * 这样即使用户切到一个不支持档位的模型，也不会把一个上游不认的参数发出去。
 *
 * 与 manifest 档位的优先级：**用户显式选择优先**。manifest 的 required_model_profiles
 * 是任务类型的默认画像，用户在设置里主动调档是更强的直接指令；两者都缺席才不下发。
 */
function resolveAgentReasoningEffort(modelId: string): string | undefined {
    try {
        const prefs = (useAppStore.getState() as any).modelPreferences;
        const chosen = String(prefs?.thinking?.effort || '').trim();
        if (!chosen) return undefined;
        const model = getModelById(modelId);
        const declared = Array.isArray(model?.reasoningEfforts) ? model!.reasoningEfforts : [];
        return declared.includes(chosen) ? chosen : undefined;
    } catch {
        return undefined;
    }
}

function createRuntimeSessionNonce(): string {
    const strongNonce = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : Math.random().toString(36).slice(2, 14);
    return `runtime-${Date.now().toString(36)}-${strongNonce || 'fallback'}`;
}

function readRuntimeSessionFromAgentResult(result: unknown): RuntimeSession | undefined {
    const session = (result as { data?: { runtimeSession?: unknown } } | null)?.data?.runtimeSession;
    if (!session || typeof session !== 'object') return undefined;
    const value = session as Partial<RuntimeSession>;
    if (value.version !== 'runtime-session/v0'
        || !value.identity
        || !value.stageState
        || !value.stageTrace
        || value.finalized !== true) {
        return undefined;
    }
    return value as RuntimeSession;
}

async function finalizeRuntimeArtifactsForProject(input: {
    projectPath?: string;
    publication: RuntimeArtifactPublicationInput;
    authorizationTokens: Map<string, string>;
}): Promise<ArtifactRepositoryReadProjection | undefined> {
    const projectPath = String(input.projectPath || '').trim();
    const finalizeBridge = window.designEcho?.finalizeRuntimeArtifacts;
    if (!projectPath || typeof finalizeBridge !== 'function') {
        return undefined;
    }
    const session = input.publication.runtimeSession;
    if (shouldDeferRuntimeArtifactFinalizationForInteraction(session)) return undefined;
    const authorizationToken = input.authorizationTokens.get(session.identity.runId);
    if (!authorizationToken) return undefined;
    const request: RuntimeArtifactFinalizationRequest = {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken,
        artifacts: {
            ...(input.publication.runtimeDesignBriefDeclaration
                ? { runtimeDesignBrief: input.publication.runtimeDesignBriefDeclaration }
                : {}),
            ...(input.publication.runtimeDesignStrategyDeclaration
                ? { runtimeDesignStrategy: input.publication.runtimeDesignStrategyDeclaration }
                : {}),
            ...(input.publication.runtimeActionPlanDeclaration
                ? { runtimeActionPlan: input.publication.runtimeActionPlanDeclaration }
                : {}),
            ...(input.publication.designVerdict
                ? { evaluationReport: input.publication.designVerdict }
                : {}),
            ...(input.publication.runtimeDeliveryVerification
                ? { runtimeDeliveryVerification: input.publication.runtimeDeliveryVerification }
                : {})
        }
    };
    if (Object.keys(request.artifacts).length === 0) return undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await finalizeBridge(projectPath, request);
            if (response?.success === true) {
                input.authorizationTokens.delete(session.identity.runId);
                return readArtifactRepositoryProjection(response.projection);
            }
            const code = String(response?.code || '');
            const retryable = !code.startsWith('authorization_') && code !== 'invalid_finalization';
            if (attempt === 0 && retryable) continue;
            console.warn(`[ArtifactRepository] Runtime 收尾发布失败：${response?.error || '未知原因'}`);
            return undefined;
        } catch (error: any) {
            if (attempt === 0) continue;
            console.warn(`[ArtifactRepository] Runtime 收尾发布异常：${error?.message || String(error)}`);
            return undefined;
        }
    }
    return undefined;
}

async function authorizeRuntimeArtifactFinalizationForProject(input: {
    projectPath?: string;
    requestId: string;
    skillId: string;
    taskType: string;
    previousRunId?: string;
    /** 同代 plan-neutral identity 的 runId；提供时主进程在同一身份上原地绑定 Manifest，不新建第二身份。 */
    identityRunId?: string;
}): Promise<RuntimeArtifactAuthorizationGrant | undefined> {
    const projectPath = String(input.projectPath || '').trim();
    const authorizationBridge = window.designEcho?.authorizeRuntimeArtifactFinalization;
    if (!projectPath || typeof authorizationBridge !== 'function') return undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await authorizationBridge(projectPath, {
                version: RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
                requestId: input.requestId,
                skillId: input.skillId,
                taskType: input.taskType,
                ...(input.previousRunId ? { previousRunId: input.previousRunId } : {}),
                ...(input.identityRunId ? { identityRunId: input.identityRunId } : {})
            });
            if (response?.success !== true) {
                console.warn(`[ArtifactRepository] Runtime 收尾授权失败：${response?.error || '未知原因'}`);
                return undefined;
            }
            const grant = readRuntimeArtifactAuthorizationGrant(response.grant);
            if (!grant || grant.skillId !== input.skillId || grant.taskType !== input.taskType) {
                console.warn('[ArtifactRepository] Runtime 收尾授权响应非法，已禁用本轮 Artifact 发布。');
                return undefined;
            }
            if (input.identityRunId && grant.runtimeIdentity.runId !== input.identityRunId) {
                console.warn('[ArtifactRepository] Runtime 收尾授权未在同一身份上原地绑定，已禁用本轮 Artifact 发布。');
                return undefined;
            }
            return grant;
        } catch (error: any) {
            if (attempt === 0) continue;
            console.warn(`[ArtifactRepository] Runtime 收尾授权异常：${error?.message || String(error)}`);
            return undefined;
        }
    }
    return undefined;
}

/**
 * 签发不预判业务类型的 plan-neutral TaskRun identity。
 *
 * 在模型理解需求前由主进程先签发稳定身份（sessionId/runId/generation，无 skillId/taskType），
 * 使 taskRunId 在品类确定前即稳定；模型结构化声明成功后，调用方在同一 runId 上
 * 通过 `authorizeRuntimeArtifactFinalizationForProject`（携带 identityRunId）原地绑定 Manifest。
 * 该身份本身不授予 Tool 权限、不授予 Artifact 收尾权。
 */
async function issuePlanNeutralSessionIdentityForProject(input: {
    projectPath?: string;
    requestId: string;
}): Promise<RuntimeSessionIdentityIssuanceGrant | undefined> {
    const projectPath = String(input.projectPath || '').trim();
    const issuanceBridge = window.designEcho?.issueRuntimeSessionIdentity;
    if (!projectPath || typeof issuanceBridge !== 'function') return undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await issuanceBridge(projectPath, {
                version: RUNTIME_SESSION_IDENTITY_ISSUANCE_REQUEST_VERSION,
                requestId: input.requestId
            });
            if (response?.success !== true) {
                console.warn(`[ArtifactRepository] plan-neutral Runtime 身份签发失败：${response?.error || '未知原因'}`);
                return undefined;
            }
            const grant = readRuntimeSessionIdentityIssuanceGrant(response.grant);
            if (!grant || grant.runtimeIdentity.skillId || grant.runtimeIdentity.taskType) {
                console.warn('[ArtifactRepository] plan-neutral Runtime 身份响应非法，已禁用本轮身份绑定。');
                return undefined;
            }
            return grant;
        } catch (error: any) {
            if (attempt === 0) continue;
            console.warn(`[ArtifactRepository] plan-neutral Runtime 身份签发异常：${error?.message || String(error)}`);
            return undefined;
        }
    }
    return undefined;
}

function isSameRuntimeTaskRunGeneration(
    left: RuntimeSessionIdentity,
    right: RuntimeSessionIdentity
): boolean {
    return left.sessionId === right.sessionId
        && left.runId === right.runId
        && left.generation === right.generation;
}

/**
 * 只有 staged Runtime Session 的 generation 才以 Runtime runId 作为运行档案主键。
 * plan-neutral Reflexion 保留同一个可晚绑定的 TaskRun identity 来承接预算与权限边界，
 * 运行档案则走既有 parentRunId 链生成独立记录，避免多轮写到同一 <runId>.json 相互覆盖。
 */
function resolveRuntimeRunRecordIdentity(
    runtimeContractBundle: AgentTaskRuntimeContractBundle | undefined,
    runtimeSessionIdentity: RuntimeSessionIdentity | undefined
): RuntimeSessionIdentity | undefined {
    return runtimeContractBundle ? runtimeSessionIdentity : undefined;
}

/**
 * Harness v1 · H1：把一轮自主运行持久化为 Run Record（<project>/.designecho/runs/）。
 * 同步组装（纯逻辑摘要化，无原始载荷）、异步落盘 fire-and-forget——记录失败只
 * console.warn 具体原因，绝不影响任务结果（boundaries.neverBlocksTaskResult）。
 * 返回 runId 供 reflexion 轮间 parentRunId 链接与结果里的 runRecordRef。
 */
function persistAgentRunRecordSafely(input: {
    result: {
        success?: unknown;
        cancelled?: unknown;
        iterations?: unknown;
        stopReason?: unknown;
        toolCallLog?: Array<{ name?: unknown; arguments?: unknown; result?: unknown }>;
        executionSummary?: unknown;
    };
    userTask: string;
    controlPlane?: { requestKind?: unknown; route?: unknown; skillId?: unknown } | null;
    projectPath?: string;
    conversationScope?: AgentRunConversationScope;
    projectState?: unknown;
    parentRunId?: string;
    resumeFreshness?: RuntimeActionPlanResumeFreshness;
    runtimeSessionIdentity?: RuntimeSessionIdentity;
    runtimeContractStatus?: RuntimeContractStatus;
    modelIdentity?: {
        modelId: string;
        provider: string;
        apiModelId?: string;
    };
}): string | undefined {
    try {
        const record = buildAgentRunRecord({
            now: new Date().toISOString(),
            goal: input.userTask,
            projectPath: input.projectPath,
            conversationScope: input.conversationScope,
            projectState: input.projectState,
            parentRunId: input.parentRunId,
            resumeFreshness: input.resumeFreshness,
            runtimeSessionIdentity: input.runtimeSessionIdentity,
            runtimeContractStatus: input.runtimeContractStatus,
            modelIdentity: input.modelIdentity,
            controlPlane: input.controlPlane || null,
            result: input.result as any
        });
        const bridge = (window as any)?.designEcho?.writeAgentRunRecord;
        if (typeof bridge !== 'function') {
            // 旧 preload（未重启加载新桥）：记录不落盘，诚实提示一次即可
            console.warn('[RunRecord] preload 未提供 writeAgentRunRecord（应用需重启加载新桥），本轮运行记录未持久化');
            return record.runId;
        }
        if (!input.projectPath) {
            // 无项目的运行不持久化（记录归属项目目录）；不告警刷屏
            return record.runId;
        }
        Promise.resolve(bridge(record, input.projectPath)).then((outcome: any) => {
            if (!outcome || outcome.success !== true) {
                console.warn(`[RunRecord] 运行记录写入失败：${outcome?.error || '未知原因'}`);
            }
        }).catch((error: any) => {
            console.warn(`[RunRecord] 运行记录写入异常：${error?.message || String(error)}`);
        });
        return record.runId;
    } catch (error: any) {
        console.warn(`[RunRecord] 运行记录组装失败（不影响任务结果）：${error?.message || String(error)}`);
        return undefined;
    }
}

/**
 * V0-4 重入纪律播种（纯读、无副作用）：从上一轮运行结果派生确定性纪律旗标。
 * 复用 run-record 的 checkpoint 口径（buildAgentRunRecord 无 IPC/FS），只取
 * documentCreated/layoutRendered——这两个事实已被上一轮工具日志确证，回灌给下一轮纪律状态机，
 * 避免重入把已建画布/已排版当成「从零」而在存量画布旁另建空文档。
 * 两个旗标都为 false（首轮式空结果 / 派生异常）时返回 undefined：不播种、回退现状全 false，绝不抛错。
 */
function deriveReflexionDisciplineSeed(result: unknown): Partial<DesignDisciplineState> | undefined {
    try {
        const checkpoint = buildAgentRunRecord({
            now: '',
            goal: '',
            result: (result || {}) as any
        }).checkpoint;
        if (!checkpoint.documentCreated && !checkpoint.layoutRendered) return undefined;
        return {
            documentCreated: checkpoint.documentCreated,
            layoutRendered: checkpoint.layoutRendered
        };
    } catch {
        return undefined;
    }
}

/**
 * 开工时念给模型的「同项目近期几稿」摘要（recent-designs.json 指纹）：让它知道自己上几稿做了什么，
 * 别每次都交同版面签名、同色系、同标题的稿。读不到 / 没有项目 → 空串，不影响开工。
 */
async function readRecentDesignsOpeningContext(projectPath?: string): Promise<string> {
    const path = String(projectPath || '').trim();
    if (!path) return '';
    try {
        const read = await (window as any).designEcho?.invoke?.('designWorkshop:readRecentDesigns', { projectPath: path });
        const items = read?.success && Array.isArray(read.ledger?.items) ? read.ledger.items : [];
        if (items.length === 0) return '';
        const { summarizeRecentDesignsForModel } = await import('../../../shared/design-workshop/recent-designs');
        return summarizeRecentDesignsForModel(items, 3);
    } catch {
        return '';
    }
}

export const autonomousAgentExecutor: SkillExecutor = {
    skillId: 'autonomous-agent',

    async execute(executeParams: SkillExecuteParams): Promise<AgentResult> {
        const {
            params,
            callbacks,
            signal,
            context,
            agentTaskPlan,
            runtimeInteractiveReentry,
            adoptRuntimeInteractiveReentry
        } = executeParams;
        const userTask = params.userTask || params.task || params.userInput || '';
        const runRecordProjectPath: string | undefined = context?.projectContext?.projectPath;
        const runRecordConversationId = String(context?.conversationId || '').trim();
        const runRecordConversationBranchId = String(context?.conversationBranchId || '').trim();
        const runRecordConversationScope: AgentRunConversationScope | undefined = (
            runRecordConversationId && runRecordConversationBranchId
        )
            ? {
                conversationId: runRecordConversationId,
                branchId: runRecordConversationBranchId
            }
            : undefined;

        if (!userTask) {
            return {
                success: false,
                message: '未提供任务描述。',
                error: 'Missing userTask'
            };
        }

        if (runtimeInteractiveReentry) {
            const validation = validateRuntimeInteractiveReentry(runtimeInteractiveReentry);
            if (!validation.ok || !adoptRuntimeInteractiveReentry) {
                return {
                    success: false,
                    message: '刚才的确认无法和原任务状态可靠对应，因此没有继续修改。请重新发起当前任务。',
                    error: validation.ok
                        ? 'runtime_interactive_reentry_adoption_callback_missing'
                        : validation.issues.join(','),
                    data: {
                        executesModel: false,
                        executesPhotoshop: false,
                        grantsToolPermission: false
                    }
                };
            }
            const declaredTaskType = String(params.declaredTaskType || '').trim();
            const declaredSkillId = String(params.declaredSkillId || '').trim();
            if ((declaredTaskType && declaredTaskType !== runtimeInteractiveReentry.plan.taskType)
                || (declaredSkillId && declaredSkillId !== runtimeInteractiveReentry.plan.skillId)) {
                return {
                    success: false,
                    message: '刚才的确认属于另一项任务，当前没有继续修改。请重新发起当前任务。',
                    error: 'runtime_interactive_reentry_declaration_conflict',
                    data: {
                        executesModel: false,
                        executesPhotoshop: false,
                        grantsToolPermission: false
                    }
                };
            }
        }

        const runtimeParams: Record<string, any> = {
            ...(params || {}),
            ...(runtimeInteractiveReentry ? {
                declaredTaskType: runtimeInteractiveReentry.plan.taskType,
                declaredSkillId: runtimeInteractiveReentry.plan.skillId
            } : {}),
            agentIntentControlPlane: completeAutonomousAgentIntentControlPlane(params || {}, context, String(userTask))
        };
        const providerToolDenyPolicy = buildAgentProviderToolDenyPolicy(runtimeParams);
        const dimensionSpec = normalizeDesignDimensionSpec(
            context?.designDimensionSpec || useAppStore.getState().designDimensionSpec
        );
        const userDocumentOverrides = extractUserExplicitDocumentOverrides(userTask);
        const capabilityRuntime = resolveAutonomousCapabilityRuntime(runtimeParams, context);
        let runtimeContractBundle = capabilityRuntime.runtimeContractBundle;
        // agentic 清单（开放创意路径）：只作知识 / 预算 / 任务类型来源，全程不建 Stage 机。
        // 循环内模型再声明 agentic 任务类型时也只更新这里，不会切回 staged。
        let agenticManifestBundle = capabilityRuntime.agenticManifestBundle;
        const resolveKnowledgeBundle = (): AgentTaskRuntimeContractBundle | undefined => (
            runtimeContractBundle || agenticManifestBundle
        );
        const capabilitySession = capabilityRuntime.capabilitySession;
        let runtimeContractStatus = capabilityRuntime.runtimeContractStatus;
        if (runtimeInteractiveReentry) {
            const resolvedPlan = runtimeContractBundle?.stagePlan;
            if (!resolvedPlan
                || resolvedPlan.version !== runtimeInteractiveReentry.plan.version
                || resolvedPlan.skillId !== runtimeInteractiveReentry.plan.skillId
                || resolvedPlan.taskType !== runtimeInteractiveReentry.plan.taskType) {
                return {
                    success: false,
                    message: '原任务的运行方法已经变化，当前没有继续修改。请重新发起当前任务。',
                    error: 'runtime_interactive_reentry_manifest_mismatch',
                    data: {
                        executesModel: false,
                        executesPhotoshop: false,
                        grantsToolPermission: false
                    }
                };
            }
            capabilitySession.activateToolsForContinuation(
                readAgentReActRecoveryToolNames(
                    projectRuntimeInteractiveWorkflowResult(runtimeInteractiveReentry)
                )
            );
        }

        // R0 已解析 Manifest 时，task_type 直接来自 Manifest 单一真相源，供通用设计纪律
        // 与场景预算消费；不再要求模型额外调用 declareDesignIntent 重复声明。
        if (!runtimeParams.declaredTaskType && resolveKnowledgeBundle()?.manifest.task_type) {
            runtimeParams.declaredTaskType = resolveKnowledgeBundle()?.manifest.task_type;
        }
        if (!runtimeParams.declaredWorkMode && runtimeContractBundle?.stagePlan.expectedWorkMode) {
            runtimeParams.declaredWorkMode = runtimeContractBundle.stagePlan.expectedWorkMode;
        }

        // R0 fail-closed：一旦上游明确选择了 Skill / task type，就必须解析到唯一 Manifest。
        // 不能在身份丢失时静默退回 generic broad discovery，否则 R1-R5/E1-E2 治理全部绕过。
        if (runtimeContractStatus.status === 'selected_manifest_missing') {
            return {
                success: false,
                message: '当前选择的设计能力没有对应运行清单，任务已在执行前停止。',
                error: 'runtime_selected_manifest_missing',
                data: {
                    runtimeContractStatus,
                    executesModel: false,
                    executesPhotoshop: false,
                    grantsToolPermission: false
                }
            };
        }
        const startupExecutionScope = validateRuntimeExecutionScope(runtimeContractBundle, runtimeParams);
        if (!startupExecutionScope.success) {
            return {
                success: false,
                message: startupExecutionScope.error || '当前局部修改缺少可验证的唯一目标。',
                error: startupExecutionScope.code || 'runtime_execution_scope_missing',
                data: {
                    runtimeContractStatus,
                    executesModel: false,
                    executesPhotoshop: false,
                    grantsToolPermission: false
                }
            };
        }
        const runtimeArtifactAuthorizationTokens = new Map<string, string>();
        if (runtimeInteractiveReentry?.artifactAuthorizationToken) {
            runtimeArtifactAuthorizationTokens.set(
                runtimeInteractiveReentry.session.identity.runId,
                runtimeInteractiveReentry.artifactAuthorizationToken
            );
        }
        let runtimeSessionIdentity: RuntimeSessionIdentity | undefined =
            runtimeInteractiveReentry?.session.identity;
        let runtimeSessionSeed: RuntimeSession | undefined = runtimeInteractiveReentry?.session;
        let runtimePlanningContextSeed: RuntimePlanningContextSeed | undefined;
        let requestPerformanceUsageSeed: RuntimePerformanceUsage | undefined;
        let incomingReflexionHandoff: ReflexionHandoff | undefined;
        let runtimeInteractiveReentryForAgent = runtimeInteractiveReentry;
        let adoptRuntimeInteractiveReentryForAgent = adoptRuntimeInteractiveReentry;

        const requestWebSearchIntent = runtimeParams.providerNativeWebSearchIntent as ChatWebSearchIntent | undefined;
        // 自主循环、图片观察与视觉质检始终复用用户选择的同一个全模态 Agent 模型。
        const primaryTaskType: ConversationTaskType = 'logic';
        const primaryDispatchPlan = buildPrimaryAgentDispatchPlan(primaryTaskType);
        const requestBoundModelId = String(runtimeParams.primaryModelId || '').trim();
        const requestBoundModel = requestBoundModelId
            ? findConfiguredModelInRendererState(requestBoundModelId)
            : null;
        let modelId = '';
        if (requestBoundModelId) {
            if (requestBoundModel && isAgentMultimodalModelConfig(requestBoundModel)) {
                modelId = requestBoundModelId;
            }
        } else {
            modelId = resolvePrimaryAgentModelId(primaryDispatchPlan, primaryTaskType);
        }
        if (!modelId) {
            // 保留内部错误码便于调试；用户只看到唯一 Agent 模型的可行动说明。
            return buildNoUsableModelResult(primaryTaskType);
        }
        const effectivePrimaryDispatchPlan = {
            ...primaryDispatchPlan,
            selectedModelId: modelId,
            candidateModelIds: [modelId]
        };
        const runtimeModelConfig = findConfiguredModelInRendererState(modelId) || undefined;
        const primaryThinkingEnabled = typeof runtimeParams.primaryModelThinkingEnabled === 'boolean'
            ? runtimeParams.primaryModelThinkingEnabled
            : resolveAgentThinkingEnabled(modelId);
        // 关闭思考时不再谈强度：下发一个 effort 只会让上游在"已关闭"和"要多想"之间自相矛盾。
        const userSelectedReasoningEffort = primaryThinkingEnabled
            ? resolveAgentReasoningEffort(modelId)
            : undefined;
        const runRecordModelIdentity = runtimeModelConfig?.provider
            ? {
                modelId,
                provider: runtimeModelConfig.provider,
                ...(runtimeModelConfig.apiModelId
                    ? { apiModelId: runtimeModelConfig.apiModelId }
                    : {})
            }
            : undefined;
        runtimeParams.canObserveAttachedImages = isAgentMultimodalModelConfig(
            runtimeModelConfig
        );
        const designDisciplineContext = resolveAutonomousDesignDisciplineContext(runtimeParams, context);
        const designDisciplineActive = designDisciplineContext.active;
        let effectiveDesignDisciplineContext = designDisciplineContext;
        // 预算画像跟着清单走：agentic 清单同样贡献 performance_profile（详情页 30/140/70），
        // 否则会退回未绑定默认档，被真机证明会在干活中途被杀（run 469：14 轮 6 写入后预算耗尽）。
        let autonomousPerformancePolicy = resolveAutonomousPerformancePolicy(
            runtimeParams,
            context,
            designDisciplineContext,
            resolveKnowledgeBundle()
        );
        const runtimeBudget = buildAutonomousAgentRuntimeBudget({
            requestedMaxIterations: runtimeParams.maxIterations,
            defaultMaxIterations: autonomousPerformancePolicy?.budget.maxIterations,
            defaultSource: designDisciplineActive ? 'stage-autonomous-agent-default' : undefined
        });
        let maxIterations = autonomousPerformancePolicy
            ? Math.min(runtimeBudget.maxIterations, autonomousPerformancePolicy.budget.maxIterations)
            : runtimeBudget.maxIterations;
        let runtimeActivity = createAutonomousAgentRuntimeActivity();
        const agentCallbacks: AgentCallbacks = {
            onThinking: callbacks?.onThinking,
            onStep: callbacks?.onStep,
            onTaskPlanPresentation: callbacks?.onTaskPlanPresentation,
            onSnapshotImage: callbacks?.onSnapshotImage,
            onToolStart: (toolName) => {
                runtimeActivity.startedToolNames.push(toolName);
                callbacks?.onToolStart?.(toolName);
            },
            onToolComplete: (toolName, result) => {
                runtimeActivity.completedToolCalls.push({
                    name: toolName,
                    // AgentCallbacks 当前不携带参数或 callId；保留真实名称和结果，并在失败记录里
                    // 明确标注这是部分审计，不能伪装成完整 Agent toolCallLog。
                    arguments: {},
                    result
                });
                callbacks?.onToolComplete?.(toolName, result);
            },
            onProgress: callbacks?.onProgress,
            onMessage: callbacks?.onMessage,
            onIterationComplete: (iteration) => {
                runtimeActivity.iterationsCompleted = Math.max(
                    runtimeActivity.iterationsCompleted,
                    iteration
                );
            }
        };
        const webSearchVisibility: WebSearchVisibilityState = {
            intent: requestWebSearchIntent,
            callbacks: agentCallbacks,
            started: false,
            completed: false
        };

        // Project State 与 reviewed memory 属于 generation-scoped data context：启动、晚绑定和
        // Reflexion 新代都通过同一个 loader 全量替换。读取异常保留本 run 的 last-good，
        // 成功空结果则移除对应 item；不建立第二 Context owner 或跨 run 缓存。
        let designStateSummary = '';
        let designMemorySummary = '';
        let designProjectStateForFreshness: unknown;
        let designStateSnapshotStatus: RuntimeContextSnapshotStatus = 'empty';
        let designMemorySnapshotStatus: RuntimeContextSnapshotStatus = 'empty';
        let generationDataContextItems: RuntimeContextItem[] = [];
        const stateProjectPath: string | undefined = context?.projectContext?.projectPath;
        const refreshGenerationDataContext = async (
            includeReviewedMemory: boolean
        ): Promise<void> => {
            let nextDesignStateSummary = designStateSummary;
            let nextProjectState = designProjectStateForFreshness;
            let nextDesignStateSnapshotStatus = designStateSnapshotStatus;
            if (!stateProjectPath) {
                nextDesignStateSummary = '';
                nextProjectState = undefined;
                nextDesignStateSnapshotStatus = 'empty';
            } else {
                const designEchoApi = (window as any).designEcho;
                if (typeof designEchoApi?.getDesignState === 'function') {
                    try {
                        const stateResp = await designEchoApi.getDesignState(stateProjectPath);
                        if (stateResp?.success) {
                            if (stateResp.state) {
                                const { buildDesignProjectStateSummary } = await import('../../../shared/design-project-state');
                                nextProjectState = stateResp.state;
                                nextDesignStateSummary = buildDesignProjectStateSummary(stateResp.state);
                                nextDesignStateSnapshotStatus = 'fresh';
                            } else {
                                nextProjectState = undefined;
                                nextDesignStateSummary = '';
                                nextDesignStateSnapshotStatus = 'empty';
                            }
                        } else {
                            nextDesignStateSnapshotStatus = nextDesignStateSummary
                                ? 'last_good'
                                : 'empty';
                            console.warn('[AutonomousAgent] 项目状态读取未成功，继续使用本轮上一份有效快照。');
                        }
                    } catch (error: any) {
                        nextDesignStateSnapshotStatus = nextDesignStateSummary
                            ? 'last_good'
                            : 'empty';
                        console.warn(`[AutonomousAgent] 读取项目状态失败，继续使用本轮上一份有效快照：${error?.message || error}`);
                    }
                } else {
                    nextDesignStateSnapshotStatus = nextDesignStateSummary
                        ? 'last_good'
                        : 'empty';
                }
            }

            let nextDesignMemorySummary = includeReviewedMemory ? designMemorySummary : '';
            let nextDesignMemorySnapshotStatus = includeReviewedMemory
                ? designMemorySnapshotStatus
                : 'empty';
            if (includeReviewedMemory) {
                try {
                    const { buildDesignMemoryPromptSection } = await import('./design-planner-context');
                    // 这里的空字符串是合法的“当前没有已审核记忆”，与上面的读取异常不同。
                    nextDesignMemorySummary = buildDesignMemoryPromptSection({
                        userText: userTask,
                        limit: 3,
                        context
                    });
                    nextDesignMemorySnapshotStatus = nextDesignMemorySummary ? 'fresh' : 'empty';
                } catch (error: any) {
                    nextDesignMemorySnapshotStatus = nextDesignMemorySummary
                        ? 'last_good'
                        : 'empty';
                    console.warn(`[AutonomousAgent] 读取设计经验记忆失败，继续使用本轮上一份有效快照：${error?.message || error}`);
                }
            }

            designStateSummary = nextDesignStateSummary;
            designMemorySummary = nextDesignMemorySummary;
            designProjectStateForFreshness = nextProjectState;
            designStateSnapshotStatus = nextDesignStateSnapshotStatus;
            designMemorySnapshotStatus = nextDesignMemorySnapshotStatus;
            generationDataContextItems = buildGenerationScopedDataContextItems({
                projectStateSummary: designStateSummary,
                projectStateStatus: designStateSnapshotStatus,
                reviewedMemorySummary: designMemorySummary,
                reviewedMemoryStatus: designMemorySnapshotStatus
            });
        };
        const getDesignStateSnapshotStatus = (): RuntimeContextSnapshotStatus => (
            designStateSnapshotStatus
        );
        // 运行事实账本：一代结束就把工具日志里的事实（看过 / 用过的素材、图上卖点线索、Agent 版面签名、
        // 新建画布、导出文件、版本）记进项目记忆。Harness 记事实，模型记判断；写入失败只记日志，
        // 绝不影响任务结果，也不作为任何门禁依据。
        const recordRunFactsToProjectStateSafely = async (input: {
            toolCallLog?: AgentToolCallLogEntry[];
            executionSummary?: AgentExecutionSummary;
        }): Promise<void> => {
            if (!stateProjectPath) return;
            const log = Array.isArray(input.toolCallLog) ? input.toolCallLog : [];
            const declaredDeliverables = agentTaskPlan?.designBrief.userDeclaredDeliverables || [];
            const completionRequirements = input.executionSummary?.taskCompletion?.required || [];
            const userDeclaredDeliverableProgress = declaredDeliverables.map((deliverable) => {
                const requirement = completionRequirements.find((item) => (
                    item.id === `user-deliverable:${deliverable.id}`
                ));
                const actual = requirement?.actual
                    && typeof requirement.actual === 'object'
                    && !Array.isArray(requirement.actual)
                    ? requirement.actual as Record<string, unknown>
                    : undefined;
                const status = requirement?.status === 'passed'
                    || requirement?.status === 'needs_review'
                    || requirement?.status === 'failed'
                    ? requirement.status
                    : 'failed';
                return {
                    deliverableId: deliverable.id,
                    label: deliverable.label,
                    status,
                    ...(typeof actual?.reference === 'string'
                        ? { evidenceReference: actual.reference }
                        : {}),
                    ...(requirement?.reason
                        ? { reason: requirement.reason }
                        : (!requirement
                            ? { reason: '本轮没有生成该交付物的完成收据。' }
                            : {}))
                };
            });
            if (log.length === 0 && userDeclaredDeliverableProgress.length === 0) return;
            const designEchoApi = (window as any).designEcho;
            if (typeof designEchoApi?.getDesignState !== 'function' || typeof designEchoApi?.updateDesignState !== 'function') return;
            try {
                const { buildDesignRunFactLedgerPatch } = await import('../../../shared/design-run-fact-ledger');
                const stateResp = await designEchoApi.getDesignState(stateProjectPath);
                const outcome = buildDesignRunFactLedgerPatch({
                    toolCallLog: log,
                    currentState: stateResp?.success ? stateResp.state : undefined,
                    goal: userTask,
                    userDeclaredDeliverableProgress
                });
                if (!outcome.patch) return;
                const writeResp = await designEchoApi.updateDesignState(stateProjectPath, outcome.patch);
                if (writeResp?.success !== true) {
                    console.warn('[RunLedger] 项目记忆事实写入未成功：', writeResp?.error || '未知原因');
                    return;
                }
                console.info('[RunLedger] 已记入项目记忆：', outcome.recorded);
            } catch (error: any) {
                console.warn(`[RunLedger] 项目记忆事实写入失败（不影响任务结果）：${error?.message || error}`);
            }
        };
        const getFreshDesignProjectStateForRecord = (): unknown => (
            getDesignStateSnapshotStatus() === 'fresh'
                ? designProjectStateForFreshness
                : undefined
        );
        const adoptOwnerConfirmedProjectStateFromRun = async (result: {
            toolCallLog?: AgentToolCallLogEntry[];
        }): Promise<void> => {
            if (getDesignStateSnapshotStatus() === 'fresh') return;
            const ownerConfirmedState = readLatestOwnerConfirmedGenerationProjectState(
                result.toolCallLog || []
            );
            if (!ownerConfirmedState) return;
            const { buildDesignProjectStateSummary } = await import('../../../shared/design-project-state');
            designProjectStateForFreshness = ownerConfirmedState;
            designStateSummary = buildDesignProjectStateSummary(ownerConfirmedState as any);
            designStateSnapshotStatus = 'fresh';
            generationDataContextItems = buildGenerationScopedDataContextItems({
                projectStateSummary: designStateSummary,
                projectStateStatus: designStateSnapshotStatus,
                reviewedMemorySummary: designMemorySummary,
                reviewedMemoryStatus: designMemorySnapshotStatus
            });
        };
        await refreshGenerationDataContext(designDisciplineContext.active);
        // 任务进度纪律（PS 连接的自主任务常驻，独立于"是否已有状态"——首轮任务恰恰没有 State，
        // 纪律负责让它被建立；任务清单是跨轮次任务真相源，续跑以它为准）。
        // 不限设计纪律品类：真机病例是「置入+剪切」图层管理任务，同样多步、同样需要任务真相源
        //（该任务曾进第二轮并重复置入——清单在场时第二轮应看到 done 项不重做）。
        let taskStateDisciplineSection = '';
        if (designDisciplineContext.active || resolveCurrentPhotoshopConnection(context) === true) {
            try {
                const { buildTaskStateDisciplineSection } = await import('../../../shared/design-project-state');
                taskStateDisciplineSection = buildTaskStateDisciplineSection();
            } catch (error: any) {
                console.warn(`[AutonomousAgent] 读取任务进度纪律失败（不影响执行）：${error?.message || error}`);
            }
        }
        // 注入设计尺寸规范（用户可配置，默认预设）——尺寸知识不写死在提示词里
        const dimensionSpecSummary = summarizeDesignDimensionSpecForAgent(dimensionSpec);
        const baseSystemPrompt = buildBaseSystemPrompt(runtimeParams, context);
        const baseCapabilityPolicyPrompt = buildBaseCapabilityPolicyPrompt(runtimeParams, context);
        const designerAgentDecisionInput = buildDesignerAgentDecisionInput(runtimeParams, context);
        // 结构化设计判断只是上游已经存在时的可用上下文，不是自主 Agent 开工前必须
        // 补齐的表单。没有这份数据时，模型直接根据用户目标和真实上下文判断。
        const designerAgentDecisionContract = designerAgentDecisionInput.agentDecision
            ? buildDesignerAgentDecisionContract(designerAgentDecisionInput)
            : null;
        // 专业团队是 Agent 可选能力；只有结构化 owner 显式要求时才预编译团队协作契约。
        // 普通设计任务不因品类、表单缺项或视觉缓存缺失而被 Harness 自动安排队友。
        const designerAgentTeamConsultationInput = runtimeParams.requiresDesignTeamConsultation === true
            ? buildDesignerAgentTeamConsultationInput(
                runtimeParams,
                context,
                designerAgentDecisionContract?.status
            )
            : null;
        const designerAgentTeamConsultationContract = designerAgentTeamConsultationInput
            ? buildDesignerAgentTeamConsultationContract(designerAgentTeamConsultationInput)
            : null;
        const designerAgentPromptSection = designerAgentDecisionContract
            ? designerAgentDecisionContract.promptSection
            : '';
        const designerAgentTeamPromptSection = designerAgentTeamConsultationContract
            && designerAgentTeamConsultationContract.status !== 'not_required'
            ? designerAgentTeamConsultationContract.promptSection
            : '';
        // Harness v1 · H2：加载上一轮「未完成运行」档案摘要（替代聊天考古的状态恢复）。
        // 只在有项目且档案未过期时注入；摘要自带"先验证再续做/无关则忽略"边界，相关性交模型判断。
        // 加载失败绝不影响任务（try/catch + 空摘要照常开跑）。
        let runResumeBriefSection = '';
        let runResumeFreshness: RuntimeActionPlanResumeFreshness | undefined;
        if (runRecordProjectPath) {
            try {
                const listBridge = (window as any)?.designEcho?.listAgentRunRecords;
                if (typeof listBridge === 'function') {
                    const listed = await listBridge(runRecordProjectPath, 5);
                    const initialResumeBrief = buildRunRecordResumeBrief({
                        records: Array.isArray(listed?.records) ? listed.records : [],
                        nowMs: Date.now(),
                        preferredSourceRunId: String(runtimeParams.resumeSourceRunId || '').trim() || undefined,
                        conversationScope: runRecordConversationScope
                    });
                    let resumeBrief = initialResumeBrief;
                    const candidate = initialResumeBrief.freshnessCandidate;
                    if (candidate) {
                        const probe = buildRuntimeResumeFreshnessProbeRequest(candidate.contextAnchor);
                        let probeSucceeded = false;
                        let currentAnchor = buildRuntimeResumeContextAnchor({
                            toolCallLog: [],
                            projectState: getFreshDesignProjectStateForRecord()
                        });
                        const probeCapabilityBlock = probe
                            ? buildAgentProviderToolDenyBlock(
                                providerToolDenyPolicy,
                                probe.toolName,
                                probe.arguments
                            )
                            : null;
                        if (
                            probe
                            && !probeCapabilityBlock
                            && classifyAgentToolExecution(probe.toolName, probe.arguments) === 'read_only_observation'
                        ) {
                            let probeResult: any;
                            try {
                                probeResult = await executeToolCall(probe.toolName, probe.arguments, { signal });
                            } catch (error: any) {
                                probeResult = { success: false, error: error?.message || String(error) };
                            }
                            probeSucceeded = probeResult?.success !== false;
                            currentAnchor = buildRuntimeResumeContextAnchor({
                                toolCallLog: [{
                                    name: probe.toolName,
                                    arguments: probe.arguments,
                                    result: probeResult
                                }],
                                projectState: getFreshDesignProjectStateForRecord()
                            });
                        } else if (!candidate.contextAnchor?.document) {
                            // 旧记录没有强文档锚点：无需伪装执行探针，直接进入 insufficient_context。
                            probeSucceeded = true;
                        }
                        runResumeFreshness = evaluateRuntimeActionPlanResumeFreshness({
                            sourceRunId: candidate.sourceRunId,
                            previousAnchor: candidate.contextAnchor,
                            currentAnchor,
                            completedStepIds: candidate.completedStepIds,
                            completedStepDescriptors: candidate.completedStepDescriptors,
                            resumeStepIds: candidate.resumeStepIds,
                            probeSucceeded
                        });
                        resumeBrief = buildRunRecordResumeBrief({
                            records: Array.isArray(listed?.records) ? listed.records : [],
                            nowMs: Date.now(),
                            preferredSourceRunId: String(runtimeParams.resumeSourceRunId || '').trim() || undefined,
                            conversationScope: runRecordConversationScope,
                            freshness: runResumeFreshness
                        });
                    }
                    if (resumeBrief.applicable && resumeBrief.brief) {
                        runResumeBriefSection = resumeBrief.brief;
                        console.debug('[RunResume] 已装载续做摘要:', {
                            reason: resumeBrief.reason,
                            freshness: runResumeFreshness?.status
                        });
                        agentCallbacks.onStep?.({
                            kind: 'observation',
                            title: runResumeFreshness?.status === 'verified'
                                ? '继续上次未完成的设计'
                                : '正在确认上次的设计进度',
                            detail: runResumeFreshness?.status === 'verified'
                                ? '已找到可以继续的当前进度，接着完成剩余设计。'
                                : '先确认当前文档与已有画面，再从合适的位置继续。',
                            status: runResumeFreshness?.status === 'verified' ? 'success' : 'running',
                            source: 'skill_executor',
                            audience: 'user',
                            visibility: 'user_process'
                        });
                    }
                }
            } catch (error: any) {
                console.warn(`[RunResume] 运行档案加载失败（不影响本次任务）：${error?.message || String(error)}`);
            }
        }

        const startupKnowledgeBundle = resolveKnowledgeBundle();
        const designMethodKnowledge = startupKnowledgeBundle
            ? buildDesignMethodKnowledgeRuntimeContext({
                knowledgeRefs: startupKnowledgeBundle.manifest.knowledge_refs || [],
                manifestSkillId: startupKnowledgeBundle.manifest.skill_id
            })
            : undefined;
        if (designMethodKnowledge && designMethodKnowledge.issues.length > 0) {
            throw new Error(`runtime_design_method_knowledge_invalid:${designMethodKnowledge.issues.join(',')}`);
        }

        const knowledgeTaskType = startupKnowledgeBundle?.artifactManifest?.task_type
            || startupKnowledgeBundle?.manifest.task_type
            || designDisciplineContext.taskTypeId;
        const requestedArtifactId = runtimeParams.artifactKind
            || runtimeParams.artifact_kind
            || runtimeParams.artifact;
        // Task Context（Phase 1 · DI-008）：仅当已绑定 Runtime、且 Manifest 没有提供治理方法知识时，
        // 才补取本地知识。普通自然语言、简单操作和已有方法论的任务不做隐式检索；外部参考由
        // Agent 在具体设计决策确有需要时显式调用。
        // 注意：这些是 Agent 根据任务自动检索的「候选参考」，未绑定真实 Catalog 治理
        // （无 sourceRevision/contentFingerprint/allowedUses），因此注入时按诚实候选语义标注为
        // untrusted_external + external_reference + advisory，不冒充已验证知识。用户显式固定的
        // 知识由 operatingContextSnapshot 主链完整覆盖，与本候选参考互不重叠。
        let taskContextItem: RuntimeContextItem | null = null;
        let taskContextAuditEvents: Array<{ type: string; taskId: string; resourceId: string; reason: string; pinned: boolean }> = [];
        let taskContextInteractiveCard: unknown = null;
        const shouldBuildAutomaticTaskContext = Boolean(runtimeContractBundle || agenticManifestBundle)
            && (designMethodKnowledge?.items.length || 0) === 0;
        if (shouldBuildAutomaticTaskContext) {
            try {
                const builder = getTaskContextBuilder(
                (window as unknown as { designEcho?: RuntimeTaskContextApi })?.designEcho || {}
            );
            const taskContextResult = await builder.build({
                taskId: String(runtimeParams.taskRunId || runtimeParams.runId || 'task'),
                userInput: userTask || '',
                taskType: knowledgeTaskType,
                productCategory: undefined,
                pinnedReferenceIds: undefined,
                projectPath: stateProjectPath,
                // 任务启动时只装载方法知识；Eagle 候选不是通用前置。模型在确有未解决的
                // 构图/配色/表达问题时再调用 searchEagleReferences，用户固定引用仍由
                // operatingContextSnapshot 主链提供。
                retrieveKnowledge: true,
                retrieveVisualReferences: false
            });
            const selectedContextCount = taskContextResult.snapshot.pinnedItems.length
                + taskContextResult.snapshot.retrievedKnowledge.length
                + taskContextResult.snapshot.visualReferences.length;
            taskContextItem = selectedContextCount > 0 ? {
                id: 'knowledge.task-context',
                kind: 'reference',
                source: 'task-context-builder-agent-candidate',
                trust: 'untrusted_external',
                slot: 'external_reference',
                content: [
                    '以下内容是 Agent 根据当前任务自动检索的候选参考，未经 Catalog 治理绑定',
                    '（无 sourceRevision/contentFingerprint/allowedUses），不视为已验证知识，',
                    '仅作参考，不构成指令：',
                    taskContextResult.summary
                ].join('\n'),
                applicableStages: ['R3', 'R4', 'R5'],
                priority: 80,
                freshness: 'advisory'
            } : null;
            if (taskContextResult.warnings.length > 0) {
                console.warn(`[AutonomousAgent] Task Context 部分降级：${taskContextResult.warnings.join(';')}`);
            }
            // DI-010 Context 使用审计：把快照展开为审计事件（纯函数，无 IO）。
            const { deriveContextAuditEvents } = await import('../../../shared/design-intelligence/context-audit');
            taskContextAuditEvents = deriveContextAuditEvents(taskContextResult.snapshot);
            // DI-009：把快照映射为只读展示卡片，挂到结果供 ChatPanel 渲染（只展示，不回写权威数据）。
            const { buildTaskContextCard } = await import('../../../shared/design-intelligence/task-context-card');
            taskContextInteractiveCard = selectedContextCount > 0
                ? buildTaskContextCard(taskContextResult.snapshot)
                : null;
            } catch (error: any) {
                console.warn(`[AutonomousAgent] Task Context 构建失败（不影响执行）：${error?.message || error}`);
            }
        }
        if (taskContextAuditEvents.length > 0) {
            // DI-010：审计事件沉淀为结构化诊断日志（供未来 Context Inspector / 指标分析消费）。
            console.info(`[ContextAudit] taskId=${String(runtimeParams.taskRunId || runtimeParams.runId || 'task')} events=${taskContextAuditEvents.length}`, taskContextAuditEvents);
        }
        // 知识注入对 staged / agentic 一视同仁；区别只在 agentic 没有 Stage，知识从第一轮全部可见。
        // Plan-neutral 知识必须由同一重建入口取得，不能静态塞进 contextItems；这样模型声明
        // 精确 Profile 或项目事实刷新后，旧的通用知识可以被可靠替换，而不是与新上下文叠加。
        const buildPlanNeutralRuntimeContextItems = (disciplineActive: boolean): RuntimeContextItem[] => [
            ...generationDataContextItems,
            ...buildPlanNeutralDesignKnowledgeRuntimeItems({
                designDisciplineActive: disciplineActive
            })
        ];
        const buildKnowledgeRuntimeContextItems = (input: {
            disciplineActive: boolean;
            methodKnowledge?: ReturnType<typeof buildDesignMethodKnowledgeRuntimeContext>;
            knowledgeBundle?: AgentTaskRuntimeContractBundle;
        }): RuntimeContextItem[] => {
            const knowledgeBundle = input.knowledgeBundle || resolveKnowledgeBundle();
            if (!knowledgeBundle) {
                return buildPlanNeutralRuntimeContextItems(input.disciplineActive);
            }
            return [
                ...generationDataContextItems,
                ...buildRuntimeStageContextItemsForBundle({
                    runtimeContractBundle: knowledgeBundle,
                    designDisciplineActive: input.disciplineActive,
                    requestedArtifactId,
                    taskContextItem,
                    ...(input.methodKnowledge ? { designMethodKnowledge: input.methodKnowledge } : {}),
                    stageAgnostic: !runtimeContractBundle
                }),
                ...(isAgenticExecutionModel(knowledgeBundle.manifest)
                    ? [buildAutonomousAgenticRuntimeBindingProjection({
                        runtimeContractBundle: knowledgeBundle,
                        params: runtimeParams,
                        context
                    })?.contextItem].filter((item): item is RuntimeContextItem => Boolean(item))
                    : [])
            ];
        };
        let runtimeStageContextItems: RuntimeContextItem[] = buildKnowledgeRuntimeContextItems({
            disciplineActive: designDisciplineActive,
            methodKnowledge: designMethodKnowledge
        });
        const rebuildGenerationRuntimeContextItems = (
            knowledgeBundle?: AgentTaskRuntimeContractBundle
        ): void => {
            const currentDisciplineContext = resolveAutonomousDesignDisciplineContext(
                runtimeParams,
                context
            );
            runtimeStageContextItems = buildKnowledgeRuntimeContextItems({
                disciplineActive: currentDisciplineContext.active,
                ...(knowledgeBundle ? { knowledgeBundle } : {})
            });
        };
        // 历史预算跟着主模型的真实窗口走：8k 窗口的本地模型给 2.4k 字符保证跑得起来，
        // 1M 窗口的旗舰给到 20k 字符，别让 Agent 在有 1M 空间时只记得住 6.4k 字符。
        // 窗口未知时落回原来的默认档，不因为"不知道"就改变既有行为。
        const modelContextWindow = resolveModelContextWindow(modelId)?.tokens;
        const contextCapacityPlan = buildAgentContextCapacityPlan({
            windowTokens: modelContextWindow,
            requestedOutputTokens: autonomousPerformancePolicy?.budget.maxPrimaryOutputTokens
        });
        const conversationHistoryBudget = contextCapacityPlan.history;
        const conversationHistoryRuntimeItem = buildAgentConversationHistoryRuntimeItem({
            selection: selectAgentConversationContext({
                messages: context?.conversationHistory || [],
                currentUserInput: userTask,
                maxEntries: conversationHistoryBudget.maxEntries,
                maxCharactersPerEntry: conversationHistoryBudget.maxCharactersPerEntry,
                maxTotalCharacters: conversationHistoryBudget.maxTotalCharacters
            }),
            source: 'autonomous-agent-history',
            id: 'runtime.conversation-history',
            priority: 75
        });
        const recentDesignsContext = await readRecentDesignsOpeningContext(runRecordProjectPath);

        const contextItems = ([
            {
                id: 'system.base',
                kind: 'policy',
                source: 'autonomous-agent-runtime',
                trust: 'trusted_system',
                slot: 'system_policy',
                content: baseSystemPrompt,
                priority: 100,
                freshness: 'current',
                required: true
            },
            {
                id: 'policy.model-dispatch',
                kind: 'policy',
                source: 'multimodal-model-dispatch',
                trust: 'trusted_policy',
                slot: 'capability_policy',
                content: formatPrimaryAgentDispatchPromptSection(effectivePrimaryDispatchPlan),
                priority: 90,
                freshness: 'current',
                required: true
            },
            {
                id: 'policy.execution-discipline',
                kind: 'policy',
                source: 'agent-capability-governance',
                trust: 'trusted_policy',
                slot: 'capability_policy',
                content: baseCapabilityPolicyPrompt,
                priority: 95,
                freshness: 'current',
                required: true
            },
            {
                id: 'policy.task-state-discipline',
                kind: 'policy',
                source: 'design-project-state',
                trust: 'trusted_policy',
                slot: 'capability_policy',
                content: taskStateDisciplineSection,
                priority: 80,
                freshness: 'current'
            },
            {
                id: 'policy.capability-session',
                kind: 'permission_boundary',
                source: 'capability-session',
                trust: 'trusted_policy',
                slot: 'capability_policy',
                content: [
                    '当前工具列表就是现在可以直接选择的动作。',
                    '下一步所需动作已经可见时直接使用；确实缺少时再按需加入最少的相关能力。'
                ].join('\n'),
                priority: 100,
                freshness: 'current',
                required: true
            },
            {
                id: 'context.intent-and-document',
                kind: 'goal_context',
                source: 'runtime-input-context',
                trust: 'runtime_observation',
                slot: 'runtime_context',
                content: buildBaseRuntimeContext(runtimeParams, context),
                priority: 100,
                freshness: 'current'
            },
            ...(conversationHistoryRuntimeItem ? [conversationHistoryRuntimeItem] : []),
            ...(context?.operatingContextSnapshot
                ? [{
                    ...buildOperatingContextRuntimeItem(context.operatingContextSnapshot),
                    required: true
                }]
                : []),
            {
                id: 'context.designer-decision',
                kind: 'runtime_summary',
                source: 'designer-agent-decision',
                trust: 'runtime_observation',
                slot: 'runtime_context',
                content: designerAgentPromptSection,
                priority: 80,
                freshness: 'current'
            },
            {
                id: 'context.designer-team',
                kind: 'runtime_summary',
                source: 'designer-agent-team-consultation',
                trust: 'runtime_observation',
                slot: 'runtime_context',
                content: designerAgentTeamPromptSection,
                priority: 70,
                freshness: 'current'
            },
            {
                id: 'project.dimension-spec',
                kind: 'project_state',
                source: 'design-dimension-spec',
                trust: 'governed_project',
                slot: 'project_context',
                content: dimensionSpecSummary,
                priority: 90,
                freshness: 'current'
            },
            {
                id: 'project.recent-design-fingerprints',
                kind: 'project_state',
                source: 'recent-design-fingerprints',
                trust: 'governed_project',
                slot: 'project_context',
                content: recentDesignsContext,
                priority: 45,
                freshness: 'advisory'
            },
            {
                id: 'runtime.resume-advice',
                kind: 'runtime_summary',
                source: 'agent-run-record',
                trust: 'runtime_observation',
                slot: 'runtime_context',
                content: runResumeBriefSection,
                priority: 50,
                freshness: 'advisory'
            }
        ] as RuntimeContextItem[]).filter((item) => Boolean(item.content));
        const compiledRuntimeContext = compileRuntimeContext({
            items: contextItems,
            maxTotalCharacters: contextCapacityPlan.runtimeContextCharacterCeiling
        });
        const criticalContextIds = new Set([
            'system.base',
            'policy.model-dispatch',
            'policy.execution-discipline',
            'policy.capability-session',
            ...(context?.operatingContextSnapshot ? [OPERATING_CONTEXT_RUNTIME_ITEM_ID] : [])
        ]);
        const rejectedCriticalContextIds = compiledRuntimeContext.rejectedItemIds.filter((id) => (
            criticalContextIds.has(id)
        ));
        if (rejectedCriticalContextIds.length > 0) {
            throw new Error(`runtime_context_critical_item_rejected:${rejectedCriticalContextIds.join(',')}`);
        }

        // 所有执行前置检查通过后才向主进程领取一次性 Artifact 收尾授权，避免无模型、
        // Photoshop 未就绪或关键上下文拒绝的请求占用授权记录。
        // 先签发不预判业务类型的 plan-neutral TaskRun identity，使 taskRunId 在品类确定前即稳定；
        // 当 Manifest 已解析时，同一身份在 `issue` 上原地绑定（identityRunId），不新建第二身份。
        if (!runtimeInteractiveReentry) {
        const issuedPlanNeutralIdentity = await issuePlanNeutralSessionIdentityForProject({
            projectPath: runRecordProjectPath,
            requestId: createRuntimeSessionNonce()
        });
        const planNeutralRuntimeIdentity = issuedPlanNeutralIdentity?.runtimeIdentity
            || (!runRecordProjectPath
                ? createRuntimeSessionIdentity({
                    now: new Date().toISOString(),
                    nonce: createRuntimeSessionNonce()
                })
                : undefined);
        const planNeutralRunId = planNeutralRuntimeIdentity?.runId;
        if (runtimeContractBundle) {
            const authorization = await authorizeRuntimeArtifactFinalizationForProject({
                projectPath: runRecordProjectPath,
                requestId: createRuntimeSessionNonce(),
                skillId: runtimeContractBundle.stagePlan.skillId,
                taskType: runtimeContractBundle.stagePlan.taskType,
                identityRunId: planNeutralRunId
            });
            if (authorization) {
                runtimeSessionIdentity = authorization.runtimeIdentity;
                runtimeArtifactAuthorizationTokens.set(
                    authorization.runtimeIdentity.runId,
                    authorization.authorizationToken
                );
            } else if (runRecordProjectPath && planNeutralRunId) {
                // 真实项目中已签发 plan-neutral 身份但 Manifest 绑定失败：保留身份，
                // 不静默为核心算法伪造本地授权；本轮不发布 Artifact（授权 token 缺失）。
                runtimeSessionIdentity = planNeutralRuntimeIdentity;
            } else if (runRecordProjectPath) {
                // 已选 Runtime 必须有主进程 TaskRun 身份；普通 broad discovery 不在这里被提前封锁，
                // 它会在真正声明绑定时如实返回 identity_unavailable。
                return {
                    success: false,
                    message: '主进程 Runtime 身份签发失败，任务已在执行前停止。',
                    error: 'runtime_identity_issuance_failed',
                    data: {
                        executesModel: false,
                        executesPhotoshop: false,
                        grantsToolPermission: false
                    }
                };
            } else if (planNeutralRuntimeIdentity) {
                runtimeSessionIdentity = bindRuntimeSessionIdentity({
                    identity: planNeutralRuntimeIdentity,
                    skillId: runtimeContractBundle.stagePlan.skillId,
                    taskType: runtimeContractBundle.stagePlan.taskType
                });
            }
        } else if (planNeutralRuntimeIdentity) {
            // 普通自然语言请求（尚未解析 Manifest）：以 plan-neutral 身份作为稳定 taskRunId，
            // 直接执行 Skill 或原子工具；若模型可选声明精确 Profile，则在同一身份原地绑定。
            runtimeSessionIdentity = planNeutralRuntimeIdentity;
        }
        }

        const { Agent } = await import('../agent-runtime/agent');
        // 当前正在运行的 Agent 实例。可选的 Profile 声明通过同一闭包把完整 Runtime
        // Contract 原位提交给当前 Agent，并同步刷新 Reflexion 重入所读取的变量。
        let activeAutonomousAgent: InstanceType<typeof Agent> | undefined;
        // Completion 的跨代创建事实只在当前授权 TaskRun 的内存链中流转。Run Record 的
        // parentRunId 只做诊断，Project State 只做项目记忆；两者都不能替新请求铸造产物事实。
        let taskRunDocumentCreationEvidence: TaskRunDocumentCreationEvidence | undefined;
        const taskPlanPresentationScope = {
            conversationId: String(
                context?.conversationId
                || context?.requestId
                || 'conversation:none'
            ).trim(),
            projectId: String(
                context?.operatingContextSnapshot?.workspace?.project?.projectId
                || context?.projectContext?.projectId
                || 'workspace:none'
            ).trim()
        };
        const finalizeRuntimeArtifacts = async (
            publication: RuntimeArtifactPublicationInput
        ): Promise<ArtifactRepositoryReadProjection | undefined> => (
            await finalizeRuntimeArtifactsForProject({
                projectPath: runRecordProjectPath,
                publication,
                authorizationTokens: runtimeArtifactAuthorizationTokens
            })
        );
        const bindDeclaredRuntimeContract = async (
            declaredTaskTypeId: string,
            declaredWorkMode?: string
        ): Promise<RuntimeManifestBindingResult> => {
            const declarationResolution = resolveRuntimeDeclarationForAgentTask({
                taskType: declaredTaskTypeId,
                workMode: declaredWorkMode,
                executableToolNames: capabilitySession.candidateToolNames
            });
            if (declarationResolution.status !== 'resolved') {
                return buildRuntimeDeclarationBindingFailure(declarationResolution);
            }
            const normalizedTaskTypeId = declarationResolution.canonicalDeclaration.taskType;
            const normalizedDeclaredWorkMode = declarationResolution.canonicalDeclaration.workMode;
            if (agenticManifestBundle) {
                const currentWorkMode = agenticManifestBundle.stagePlan.expectedWorkMode;
                if (agenticManifestBundle.manifest.task_type === normalizedTaskTypeId
                    && currentWorkMode === normalizedDeclaredWorkMode) {
                    return { success: true };
                }
                if (agenticManifestBundle.manifest.task_type === normalizedTaskTypeId) {
                    return {
                        success: false,
                        code: 'runtime_work_mode_switch_forbidden',
                        error: '本轮设计任务已经绑定其他工作模式，不能在同一 TaskRun 中切换。'
                    };
                }
                return {
                    success: false,
                    code: 'runtime_manifest_switch_forbidden',
                    error: '本轮设计任务已经绑定其他任务类型，不能在同一 TaskRun 中切换。'
                };
            }
            if (runtimeContractBundle) {
                const currentWorkMode = runtimeContractBundle.stagePlan.expectedWorkMode;
                if (runtimeContractBundle.manifest.task_type === normalizedTaskTypeId
                    && currentWorkMode === normalizedDeclaredWorkMode) {
                    return { success: true };
                }
                if (runtimeContractBundle.manifest.task_type === normalizedTaskTypeId) {
                    return {
                        success: false,
                        code: 'runtime_work_mode_switch_forbidden',
                        error: '本轮 Runtime 已绑定其他工作模式，不能在同一 TaskRun 中切换。'
                    };
                }
                return {
                    success: false,
                    code: 'runtime_manifest_switch_forbidden',
                    error: '本轮 Runtime 已绑定其他设计任务类型，不能在同一 TaskRun 中切换。'
                };
            }
            // 设计路径宪法：模型在循环内声明的是 agentic 任务类型时，只登记任务类型并把该清单的
            // 方法、评价、预算和交付义务加进当前 Agent；不建 Stage 机、不切 Capability 面、
            // 不改写入权限——声明是任务语义绑定，不是门票。
            if (isAgenticExecutionModel(declarationResolution.bundle.manifest)) {
                const agenticCandidate = declarationResolution.bundle;
                const currentAgent = activeAutonomousAgent;
                if (!currentAgent) {
                    return {
                        success: false,
                        code: 'runtime_active_agent_unavailable',
                        error: '本轮 Agent 尚未进入可绑定状态，设计任务声明未生效。'
                    };
                }
                const candidateRuntimeParams: Record<string, any> = {
                    ...runtimeParams,
                    declaredTaskType: normalizedTaskTypeId,
                    ...(agenticCandidate.stagePlan.expectedWorkMode
                        ? { declaredWorkMode: agenticCandidate.stagePlan.expectedWorkMode }
                        : {})
                };
                const agenticDisciplineContext = resolveAutonomousDesignDisciplineContext(
                    candidateRuntimeParams,
                    context
                );
                const candidatePerformancePolicy = resolveAutonomousPerformancePolicy(
                    candidateRuntimeParams,
                    context,
                    agenticDisciplineContext,
                    agenticCandidate
                );
                if (!candidatePerformancePolicy) {
                    return {
                        success: false,
                        code: 'runtime_performance_profile_missing',
                        error: 'Runtime 已识别任务类型，但没有解析到对应执行预算。'
                    };
                }
                const artifactContract = buildAgenticArtifactCompletionContract(agenticCandidate);
                if (!artifactContract || !agenticCandidate.evaluationProfile) {
                    return {
                        success: false,
                        code: 'runtime_agentic_contract_incomplete',
                        error: 'Runtime 已识别任务类型，但缺少有效交付契约或评价标准。'
                    };
                }
                const candidateMaxIterations = resolveDeclaredRuntimeMaxIterations({
                    runtimeBudget,
                    manifestMaxIterations: candidatePerformancePolicy.budget.maxIterations
                });
                const candidatePerformanceBudget = toAgentPerformanceBudget(candidatePerformancePolicy);
                await refreshGenerationDataContext(agenticDisciplineContext.active);
                // candidate 还没有提交到闭包 owner；显式交给 Context Compiler，确保方法知识
                // 与评价/交付契约在同一个 Tool result 边界原子生效，且失败时不留下半绑定。
                rebuildGenerationRuntimeContextItems(agenticCandidate);
                const agenticBindingCommitted = commitAgenticRuntimeDeclarationBinding({
                    agent: currentAgent,
                    capabilitySession,
                    manifest: agenticCandidate.manifest,
                    activation: {
                        artifactContract,
                        referencePolicy: projectRuntimeReferencePolicy(
                            agenticCandidate.manifest.reference_policy
                        ),
                        runtimeStageContextItems,
                        evaluationProfile: agenticCandidate.evaluationProfile,
                        performanceBudget: candidatePerformanceBudget,
                        reasoningEffort: resolveManifestReasoningEffort(agenticCandidate.manifest),
                        maxIterations: candidateMaxIterations
                    }
                });
                if (!agenticBindingCommitted) {
                    return {
                        success: false,
                        code: 'runtime_agentic_owner_binding_rejected',
                        error: '当前 Session 已绑定另一种运行合同，未切换为开放设计 Runtime。'
                    };
                }
                agenticManifestBundle = agenticCandidate;
                autonomousPerformancePolicy = candidatePerformancePolicy;
                maxIterations = candidateMaxIterations;
                runtimeParams.declaredTaskType = normalizedTaskTypeId;
                if (agenticCandidate.stagePlan.expectedWorkMode) {
                    runtimeParams.declaredWorkMode = agenticCandidate.stagePlan.expectedWorkMode;
                }
                runtimeContractStatus = buildRuntimeContractStatus({
                    selectedTaskType: normalizedTaskTypeId,
                    manifestSkillId: agenticCandidate.manifest.skill_id,
                    selectionSource: 'explicit_runtime_declaration',
                    selectionExpected: true
                });
                // 不再播报「这次怎么做：自己动手排…」（用户 08-18：要看 Agent 真实的思考，不要定死的一句）
                return { success: true };
            }
            const currentAgent = activeAutonomousAgent;
            const currentIdentity = runtimeSessionIdentity;
            if (!currentAgent || !currentIdentity) {
                return {
                    success: false,
                    code: 'runtime_plan_neutral_identity_unavailable',
                    error: '本轮缺少可绑定的 TaskRun 身份，设计任务声明未生效。'
                };
            }

            const candidateBundle = declarationResolution.bundle;
            const candidateExecutionScope = validateRuntimeExecutionScope(candidateBundle, runtimeParams);
            if (!candidateExecutionScope.success) return candidateExecutionScope;
            const candidateEvaluationProfile = candidateBundle.evaluationProfile!;
            const candidateRuntimeParams: Record<string, any> = {
                ...runtimeParams,
                declaredTaskType: normalizedTaskTypeId,
                ...(candidateBundle.stagePlan.expectedWorkMode
                    ? { declaredWorkMode: candidateBundle.stagePlan.expectedWorkMode }
                    : {})
            };
            const candidateDisciplineContext = resolveAutonomousDesignDisciplineContext(
                candidateRuntimeParams,
                context
            );
            await refreshGenerationDataContext(candidateDisciplineContext.active);
            const candidateStageContextItems: RuntimeContextItem[] = [
                ...generationDataContextItems,
                ...buildRuntimeStageContextItemsForBundle({
                    runtimeContractBundle: candidateBundle,
                    designDisciplineActive: candidateDisciplineContext.active,
                    requestedArtifactId
                    // 动态声明不触发第二次通用 TaskContext 检索；Manifest 治理知识是唯一新增来源。
                })
            ];
            const candidatePerformancePolicy = resolveAutonomousPerformancePolicy(
                candidateRuntimeParams,
                context,
                candidateDisciplineContext,
                candidateBundle
            );
            if (!candidatePerformancePolicy) {
                return {
                    success: false,
                    code: 'runtime_performance_profile_missing',
                    error: 'Runtime 已识别任务类型，但没有解析到对应执行预算。'
                };
            }
            const candidateMaxIterations = resolveDeclaredRuntimeMaxIterations({
                runtimeBudget,
                manifestMaxIterations: candidatePerformancePolicy.budget.maxIterations
            });
            const candidatePerformanceBudget = toAgentPerformanceBudget(candidatePerformancePolicy);
            const candidateInputSources = buildAutonomousDesignBriefInputSources({
                params: candidateRuntimeParams,
                context,
                runtimeContractBundle: candidateBundle
            });

            let boundIdentity: RuntimeSessionIdentity;
            let authorization: RuntimeArtifactAuthorizationGrant | undefined;
            if (runRecordProjectPath) {
                authorization = await authorizeRuntimeArtifactFinalizationForProject({
                    projectPath: runRecordProjectPath,
                    requestId: createRuntimeSessionNonce(),
                    skillId: candidateBundle.stagePlan.skillId,
                    taskType: candidateBundle.stagePlan.taskType,
                    identityRunId: currentIdentity.runId
                });
                if (!authorization) {
                    return {
                        success: false,
                        code: 'runtime_artifact_authorization_failed',
                        error: 'TaskRun 已存在，但同代 Runtime 与 Artifact 收尾授权绑定失败。'
                    };
                }
                boundIdentity = authorization.runtimeIdentity;
            } else {
                boundIdentity = bindRuntimeSessionIdentity({
                    identity: currentIdentity,
                    skillId: candidateBundle.stagePlan.skillId,
                    taskType: candidateBundle.stagePlan.taskType
                });
            }
            if (!isSameRuntimeTaskRunGeneration(currentIdentity, boundIdentity)
                || boundIdentity.skillId !== candidateBundle.stagePlan.skillId
                || boundIdentity.taskType !== candidateBundle.stagePlan.taskType) {
                return {
                    success: false,
                    code: 'runtime_declaration_identity_generation_mismatch',
                    error: 'Runtime 绑定返回了不同的 TaskRun 身份或 generation，已拒绝切换。'
                };
            }

            // 所有异步准备与身份校验完成后，在同一个 Tool result 边界同步提交。
            // Agent 与 Capability Session 都复用当前实例；外层变量供 Reflexion 闭包读取。
                currentAgent.activateRuntimeContractFromDeclaration({
                runtimeSessionIdentity: boundIdentity,
                runtimeLoopContract: candidateBundle.runtimeLoopContract,
                runtimeStagePlan: candidateBundle.stagePlan,
                runtimeStageContextItems: candidateStageContextItems,
                runtimeDesignBriefAvailableInputSources: candidateInputSources,
                taskPlanPresentationScope,
                toolCapabilityBridge: candidateBundle.toolCapabilityBridge,
                evaluationProfile: candidateEvaluationProfile,
                getCapabilityResolution: () => capabilitySession.getResolution(),
                getActiveCapabilityIdsForTool: (toolName) => (
                    capabilitySession.getActiveCapabilityIdsForTool(toolName)
                ),
                getOnDemandActivatedCapabilityIds: () => (
                    capabilitySession.getOnDemandActivatedCapabilityIds()
                ),
                finalizeRuntimeArtifacts,
                performanceBudget: candidatePerformanceBudget,
                reasoningEffort: resolveManifestReasoningEffort(candidateBundle.manifest),
                maxIterations: candidateMaxIterations,
                ...(runResumeFreshness ? {
                    runtimeActionPlanResumeFreshness: runResumeFreshness
                } : {})
            });
            capabilitySession.bindManifest(
                candidateBundle.manifest,
                candidateBundle.stagePlan.expectedWorkMode
            );
            runtimeContractBundle = candidateBundle;
            runtimeContractStatus = buildRuntimeContractStatus({
                selectedTaskType: normalizedTaskTypeId,
                manifestSkillId: candidateBundle.manifest.skill_id,
                selectionSource: 'explicit_runtime_declaration',
                selectionExpected: true
            });
            runtimeStageContextItems = candidateStageContextItems;
            autonomousPerformancePolicy = candidatePerformancePolicy;
            maxIterations = candidateMaxIterations;
            runtimeSessionIdentity = boundIdentity;
            runtimeParams.declaredTaskType = normalizedTaskTypeId;
            if (candidateBundle.stagePlan.expectedWorkMode) {
                runtimeParams.declaredWorkMode = candidateBundle.stagePlan.expectedWorkMode;
            }
            if (authorization) {
                runtimeArtifactAuthorizationTokens.set(
                    authorization.runtimeIdentity.runId,
                    authorization.authorizationToken
                );
            }
            // 2026-08-25 过程流 codex 化：开场播报退役——模型开场自然会说明自己要做什么，
            // 框架代言只会抢在模型前面占屏（对照板刀 B）。绑定事实仍在运行档案与调试日志。
            return { success: true };
        };
        const runtimeWriteToolAllowlist = normalizeRuntimeWriteToolAllowlist(runtimeParams);
        const runtimeExactPropertyScope = readRuntimeExactPropertyScope(runtimeParams);
        const agentTaskCardScope = resolveTaskCardScope(context, runtimeParams);
        const guardedFinalDeliveryRequestId = String(
            context?.guardedPhotoshopExecutionBaseline?.requestId || ''
        ).trim();
        const captureGuardedFinalDeliveryArtifacts = (result: AgentRunResult): void => {
            if (!guardedFinalDeliveryRequestId) return;
            const projection = collectAgentFinalDeliveryDebugProjection({
                entries: result.toolCallLog,
                resultRefs: result.executionSummary?.runtimeDeliveryResultRefs,
                includeProducerReceipts: result.success === true
                    && result.cancelled !== true
                    && result.executionSummary?.status !== 'failed'
            });
            publishDebugFinalDeliveryProjection(guardedFinalDeliveryRequestId, projection);
        };
        const createAutonomousAgent = () => new Agent(
            {
                systemPrompt: compiledRuntimeContext.prompt,
                tools: capabilitySession.activeTools,
                getDynamicOperatingContext: () => [
                    capabilitySession.buildPromptSection(),
                    buildDynamicDesignTaskOperatingContext(runtimeParams, context)
                ].filter(Boolean).join('\n\n'),
                // 通用交付能力在真实设计版本形成后才进入下一轮 Tool schema。它不绑定
                // Manifest、不替模型选择保存/导出动作，也不授予文件写入权限；只避免
                // Agent 到收尾阶段再额外消耗两轮搜索与装载能力。
                activateTaskClosureCapabilities: () => (
                    capabilitySession.activateTaskClosureCapabilities()
                ),
                // 无论 Manifest 是否已经绑定，Project State / reviewed memory 都由同一个
                // Runtime Context Compiler 注入；带 applicableStages 的知识仍只在真实 Stage 可见。
                runtimeStageContextItems,
                modelId,
                // manifest 给任务类型的默认档位；用户在设置里显式选的档位优先级更高，
                // 放在后面覆盖它（对象展开后写胜出）。两者都没有就不下发该参数。
                ...projectManifestReasoningEffort(
                    runtimeContractBundle?.manifest || agenticManifestBundle?.manifest
                ),
                ...(userSelectedReasoningEffort
                    ? { reasoningEffort: userSelectedReasoningEffort as ModelReasoningEffort }
                    : {}),
                ...(modelContextWindow ? { contextWindowTokens: modelContextWindow } : {}),
                thinkingEnabled: primaryThinkingEnabled,
                replayProviderReasoningContent: Boolean(
                    shouldReplayProviderReasoningContent({
                        provider: runtimeModelConfig?.provider,
                        thinkingEnabled: primaryThinkingEnabled
                            && autonomousPerformancePolicy?.budget.allowProviderThinking !== false
                    })
                ),
                maxIterations,
                ...(Array.isArray(runtimeParams.initialUserContentParts)
                    ? { initialUserContentParts: runtimeParams.initialUserContentParts }
                    : {}),
                // 通用 Agent 首轮不由 Harness 代选 Photoshop 观察。getDocumentInfo 已在基线能力里，
                // 模型确认任务确实依赖 Photoshop 后可立即调用。真机 2026-08-21 的「你好啊」与
                // 「审查系统」都被旧逻辑强制读取文档，既增加延迟，也把非设计任务错误锚定到画布。
                openingCanvasObservationMode: 'none',
                ...(autonomousPerformancePolicy ? {
                    performanceBudget: {
                        maxModelCalls: autonomousPerformancePolicy.budget.maxModelCalls,
                        maxToolCalls: autonomousPerformancePolicy.budget.maxToolCalls,
                        maxVisionCandidates: autonomousPerformancePolicy.budget.maxVisionCandidates,
                        maxInitialVisionCandidates:
                            autonomousPerformancePolicy.budget.maxInitialVisionCandidates,
                        maxVisualAnalyses: autonomousPerformancePolicy.budget.maxVisualAnalyses,
                        maxFullResolutionImageReads: autonomousPerformancePolicy.budget.maxFullResolutionImageReads,
                        softTimeBudgetMs: autonomousPerformancePolicy.budget.softTimeBudgetMs,
                        maxPrimaryOutputTokens:
                            autonomousPerformancePolicy.budget.maxPrimaryOutputTokens,
                        allowProviderThinking:
                            autonomousPerformancePolicy.budget.allowProviderThinking
                    }
                } : {}),
                signal,
                ...(agentTaskPlan ? { agentTaskPlan } : {}),
                ...(agentTaskCardScope
                    ? { taskCardScope: agentTaskCardScope }
                    : {}),
                // plan-neutral 身份也必须交给当前 Agent；循环内声明会在同一 runId/generation 上绑定。
                ...(runtimeSessionIdentity ? { runtimeSessionIdentity } : {}),
                ...(runtimeInteractiveReentryForAgent
                    ? { runtimeInteractiveReentry: runtimeInteractiveReentryForAgent }
                    : {}),
                ...(runtimeInteractiveReentryForAgent && adoptRuntimeInteractiveReentryForAgent
                    ? { adoptRuntimeInteractiveReentry: adoptRuntimeInteractiveReentryForAgent }
                    : {}),
                // 没有 staged Session 的 Reflexion 仍沿用上一 Agent 的同一请求性能账本。
                // 这是只会收紧剩余额度的内部投影，不携带 Tool 权限、质量结论或完成状态。
                ...(!runtimeContractBundle && requestPerformanceUsageSeed
                    ? { requestPerformanceUsageSeed }
                    : {}),
                ...(agenticManifestBundle?.evaluationProfile ? {
                    agenticArtifactContract: buildAgenticArtifactCompletionContract(
                        agenticManifestBundle
                    ),
                    agenticReferencePolicy: projectRuntimeReferencePolicy(
                        agenticManifestBundle.manifest.reference_policy
                    ),
                    evaluationProfile: agenticManifestBundle.evaluationProfile
                } : {}),
                ...(runtimeContractBundle ? {
                    runtimeLoopContract: runtimeContractBundle.runtimeLoopContract,
                    runtimeStagePlan: runtimeContractBundle.stagePlan,
                    runtimeDesignBriefAvailableInputSources: buildAutonomousDesignBriefInputSources({
                        params: runtimeParams,
                        context,
                        runtimeContractBundle
                    }),
                    taskPlanPresentationScope,
                    ...(runtimeSessionSeed ? { runtimeSessionSeed } : {}),
                    ...(runtimePlanningContextSeed ? { runtimePlanningContextSeed } : {}),
                    toolCapabilityBridge: runtimeContractBundle.toolCapabilityBridge,
                    evaluationProfile: runtimeContractBundle.evaluationProfile,
                    getCapabilityResolution: () => capabilitySession.getResolution(),
                    getActiveCapabilityIdsForTool: (toolName) => (
                        capabilitySession.getActiveCapabilityIdsForTool(toolName)
                    ),
                    getOnDemandActivatedCapabilityIds: () => (
                        capabilitySession.getOnDemandActivatedCapabilityIds()
                    ),
                    finalizeRuntimeArtifacts,
                    ...(runResumeFreshness ? {
                        runtimeActionPlanResumeFreshness: runResumeFreshness
                    } : {})
                } : {}),
                ...(incomingReflexionHandoff ? { reflexionHandoff: incomingReflexionHandoff } : {}),
                ...(runtimeWriteToolAllowlist ? { runtimeWriteToolAllowlist } : {}),
                ...(runtimeExactPropertyScope
                    ? { runtimeExactPropertyScope }
                    : {}),
                taskCompletionContext: {
                    skillId: runtimeParams.skillId,
                    intentMode: runtimeParams.intentMode,
                    imageCount: Array.isArray(runtimeParams.images) ? runtimeParams.images.length : 0,
                    ...(runtimeSessionIdentity && taskRunDocumentCreationEvidence ? {
                        taskRunDocumentCreation: {
                            taskRunId: runtimeSessionIdentity.sessionId,
                            generation: runtimeSessionIdentity.generation,
                            evidence: taskRunDocumentCreationEvidence
                        }
                    } : {})
                },
                toolDecisionContext: {
                    intentControlPlane: runtimeParams.agentIntentControlPlane,
                    photoshopConnected: resolveCurrentPhotoshopConnection(context),
                    hasDocument: resolveCurrentPhotoshopDocumentPresence(context),
                    hasImageInput: Array.isArray(runtimeParams.images) ? runtimeParams.images.length > 0 : false,
                    currentDocumentUse: buildDesignDocumentRoleContext({
                        userInput: userTask,
                        currentDocumentName: resolveCurrentPhotoshopDocumentName(context),
                        hasCurrentDocument: resolveCurrentPhotoshopDocumentPresence(context) === true,
                        workMode: normalizeRuntimeDesignWorkMode(runtimeParams?.declaredWorkMode)
                    }).currentDocumentUse
                },
                callbacks: agentCallbacks,
                callModelStream: createCallModelStreamViaIPC(
                    requestWebSearchIntent,
                    webSearchVisibility,
                    runtimeActivity,
                    signal
                )
            },
            createCallModelViaIPC(requestWebSearchIntent, webSearchVisibility, runtimeActivity),
            createExecuteToolWrapper(
                agentCallbacks,
                signal,
                context,
                runtimeParams,
                designerAgentTeamConsultationContract,
                capabilitySession,
                dimensionSpec,
                userDocumentOverrides,
                providerToolDenyPolicy,
                (activatedContext) => {
                    effectiveDesignDisciplineContext = activatedContext;
                    // 同一请求的 Reflexion generation 必须继承模型已经声明的任务类型，
                    // 不能在新 Agent wrapper 中退回未激活状态。
                    if (activatedContext.taskTypeId) {
                        runtimeParams.declaredTaskType = activatedContext.taskTypeId;
                    }
                },
                bindDeclaredRuntimeContract,
                (reservationInput) => {
                    const currentAgent = activeAutonomousAgent;
                    if (!currentAgent) {
                        const roles = new Set(reservationInput.plannedRoles || []);
                        const requiredBaseAgentCalls = reservationInput.singleRole ? 1 : 4
                            + (roles.has('market-researcher') ? 1 : 0)
                            + (roles.has('copywriter') ? 1 : 0);
                        const parsedRevisionCount = Number(reservationInput.maxRevisions ?? 1);
                        const revisionCount = Number.isFinite(parsedRevisionCount)
                            ? Math.max(0, Math.min(2, Math.floor(parsedRevisionCount)))
                            : 1;
                        return {
                            status: 'blocked',
                            code: 'parent_finalization_reserve_unavailable',
                            reason: '父 Agent 尚未进入可分区状态；完整团队流水线未启动。',
                            requiredBaseAgentCalls,
                            plannedAgentCallCeiling: reservationInput.singleRole
                                ? 1
                                : requiredBaseAgentCalls + revisionCount * 4
                        };
                    }
                    return currentAgent.reserveDesignTeamChildExecution(reservationInput);
                },
                () => runtimeSessionIdentity
            )
        );

        let lastRunRecordId: string | undefined;
        let accumulatedSuccessfulMutationCalls = 0;
        // 2026-08-18 用户：不要开场就定死一句「这次怎么做：自己动手排…」——要看的是 Agent 真实的思考。
        // 2026-08-25 过程流 codex 化：staged 模式播报同样退役（对照板刀 B）——
        // 模型的开场叙述会说明走哪条流程；需要拍板时交互卡本身就是通知。
        try {
            publishDebugFinalArtifactPaths(guardedFinalDeliveryRequestId, []);
            activeAutonomousAgent = createAutonomousAgent();
            let result = await activeAutonomousAgent.run(userTask, runtimeParams.images);
            captureGuardedFinalDeliveryArtifacts(result);
            runtimeInteractiveReentryForAgent = undefined;
            adoptRuntimeInteractiveReentryForAgent = undefined;
            accumulatedSuccessfulMutationCalls = countSuccessfulMutationCalls(result);
            await recordRunFactsToProjectStateSafely(result);
            await refreshGenerationDataContext(
                resolveAutonomousDesignDisciplineContext(runtimeParams, context).active
            );
            await adoptOwnerConfirmedProjectStateFromRun(result);
            rebuildGenerationRuntimeContextItems();
            let generationProjectStateRefreshAllowsReentry = canReenterAfterGenerationProjectStateRefresh({
                hadSuccessfulStateUpdate: hasSuccessfulGenerationProjectStateUpdate(result.toolCallLog || []),
                snapshotStatus: getDesignStateSnapshotStatus()
            });

            // Reflexion 闭环：一轮结束、质量门禁未过且生成了下一轮约束时，带着复盘约束自动重跑。
            // 不拦截轮内任何工具调用（非门禁）；护栏（重入上限/取消/无进展即停）在 reflexion-reentry-policy。
            // 单一停机口径（用户拍板：质量返工 ≤3 轮、超限升级人工）：creative_design 有各轮评分卡时，
            // 质量停机控制器 evaluateQualityLoopDecision 与基础重入护栏取更严格者——任一说停即停；
            // 仅「质量分在涨」的轮次把重入上限从 ≤1 放宽到 ≤3（无进展仍按失败签名即停）。
            let reflexionReentryCount = 0;
            let previousReflexionFailureSignature: string | undefined;
            const designScorecardHistory: DesignScorecard[] = [];
            let qualityHaltNotice: string | undefined;
            let qualityHaltUserNotice: string | undefined;
            // 已完成事实交付后的纯审美 improvement 只允许一次；第二次 Judge 只负责验证/告警，
            // 不参与“分数上涨可扩到三轮”的普通质量返工放宽。
            let completedAestheticImprovementReentryUsed = false;
            // plan-neutral / legacy 无 staged Runtime Session 时，运行档案沿用 parentRunId 链；
            // staged Session 的 lineage 由其逐代 identity 拥有。
            while (!result.cancelled) {
                if (signal?.aborted) break;
                // 运行异常不是审美质量返工。不得把 Provider / Runtime 中断误包装成
                // “自动调整没有改善”，也不得据此创建下一代 Agent 重跑同一上下文。
                if (result.stopReason === 'error') break;
                // 停在用户确认点（交互卡片待确认）不是质量门禁失败，不能自动重跑——必须等用户确认。
                const awaitingUserConfirmation = result.stopReason === 'awaiting_user_confirmation'
                    || (result.data as Record<string, unknown> | undefined)?.awaitingUserConfirmation === true;
                if (awaitingUserConfirmation) break;
                // 收集本轮评分卡（仅 creative_design 且写后有新鲜结构读时 agent 收尾才评出；诚实缺席不补造）。
                const latestScorecard = result.executionSummary?.designScorecard;
                if (latestScorecard) designScorecardHistory.push(latestScorecard);
                const reflexionHandoff = ((result.data as Record<string, unknown> | undefined)?.reflexionHandoff
                    || result.executionSummary?.reflexionHandoff) as ReflexionHandoff | undefined;
                const isCompletedAestheticImprovement = isCompletedAestheticImprovementHandoff({
                    handoff: reflexionHandoff,
                    stopReason: result.stopReason,
                    alreadyReentered: completedAestheticImprovementReentryUsed
                });
                if (isCompletedAestheticImprovement) {
                    const provenance = evaluateReflexionReviewProvenance({
                        handoff: reflexionHandoff,
                        artifact: readTrustedVisualReviewArtifact(result)
                    });
                    if (!provenance.valid) {
                        qualityHaltNotice = `当前完成态审美反馈缺少与真实 ReviewSet 一致的版本来源（${provenance.status}），已停止自动返工。`;
                        qualityHaltUserNotice = '当前版本已保留。刚才的画面反馈无法和当前版本可靠对应，因此没有继续自动修改。';
                        result = {
                            ...result,
                            data: {
                                ...(result.data || {}),
                                reflexionReviewProvenance: {
                                    status: provenance.status,
                                    valid: false
                                }
                            }
                        };
                        agentCallbacks.onStep?.({
                            kind: 'observation',
                            title: '当前版本已保留',
                            detail: qualityHaltUserNotice,
                            status: 'error',
                            source: 'skill_executor',
                            audience: 'user',
                            visibility: 'user_process'
                        });
                        break;
                    }
                }
                if (reflexionHandoff && !generationProjectStateRefreshAllowsReentry) {
                    qualityHaltNotice = '当前代已写入 Design Project State，但代际重读未拿到最新快照。为避免下一代根据旧任务状态重复修改 Photoshop，已停止自动返工并保留当前版本。';
                    qualityHaltUserNotice = '当前版本已保留。项目进度还没有及时刷新，为避免重复改动画面，我先停在这里，请先看看当前版本。';
                    agentCallbacks.onStep?.({
                        kind: 'observation',
                        title: '当前版本已保留',
                        detail: qualityHaltUserNotice,
                        status: 'error',
                        source: 'skill_executor',
                        audience: 'user',
                        visibility: 'user_process'
                    });
                    break;
                }
                if (completedAestheticImprovementReentryUsed) break;
                const currentPerformanceUsage = activeAutonomousAgent
                    ?.readRequestPerformanceUsageSnapshot();
                const reentryDecision = decideQualityAwareReflexionReentry({
                    handoff: reflexionHandoff,
                    priorReentryCount: reflexionReentryCount,
                    cancelled: false,
                    previousFailureSignature: previousReflexionFailureSignature,
                    scorecardHistory: designScorecardHistory,
                    stopReason: result.stopReason,
                    ...(isCompletedAestheticImprovement ? {
                        constraintMode: 'handoff_only' as const,
                        ...(currentPerformanceUsage && autonomousPerformancePolicy ? {
                            performanceCapacity: {
                                usage: currentPerformanceUsage,
                                budget: {
                                    ...autonomousPerformancePolicy.budget,
                                    maxIterations
                                }
                            }
                        } : {})
                    } : {})
                });
                if (!reentryDecision.shouldReenter || !reflexionHandoff) {
                    // 质量口径要求升级人工 / 达返工上限 → 诚实失败。内部保留完整评分轨迹，
                    // 用户只需要知道当前版本停在哪里，不承担运行轮次与评分账本的解读。
                    if (reentryDecision.qualityHalt === 'escalate_human' || reentryDecision.qualityHalt === 'stop_max_rounds') {
                        qualityHaltNotice = buildQualityLoopHaltMessage({
                            qualityHalt: reentryDecision.qualityHalt,
                            reason: reentryDecision.qualityDecision?.reason || '质量返工停止条件已触发。',
                            scoreTrajectory: reentryDecision.scoreTrajectory,
                            reentryCount: reflexionReentryCount,
                            latestScorecard: designScorecardHistory[designScorecardHistory.length - 1]
                        });
                        qualityHaltUserNotice = reentryDecision.qualityHalt === 'escalate_human'
                            ? '当前版本已保留。这版还有需要你判断的设计取舍，请先看一下画面。'
                            : '当前版本已保留。继续自动调整已经没有明显改善，请先看一下这版再决定下一步。';
                        agentCallbacks.onStep?.({
                            kind: 'observation',
                            title: '这版需要你看一下',
                            detail: qualityHaltUserNotice,
                            status: 'error',
                            source: 'skill_executor',
                            audience: 'user',
                            visibility: 'user_process'
                        });
                    }
                    break;
                }

                // 自动 Reflexion 必须继承同一请求的性能账本。staged 运行由 Runtime Session
                // 承接；plan-neutral 运行复用签发时就已存在的同一 TaskRun identity，并从当前
                // Agent 的 canonical PerformanceLedger 取得只读累计投影。缺身份才停止，不能为
                // 了返工新建第二 Runtime 或把模型的 VLM 建议变成新的写入授权。
                if (!runtimeContractBundle) {
                    if (!runtimeSessionIdentity || !activeAutonomousAgent || !currentPerformanceUsage) {
                        qualityHaltNotice = '当前版本已保留，但本次运行缺少可承接同一请求预算的 TaskRun 身份。为避免自动返工重复计费，已停止继续修改。';
                        qualityHaltUserNotice = '这次处理已经有画面改动，但现在无法安全承接后续调整。我保留了当前版本。';
                        agentCallbacks.onStep?.({
                            kind: 'observation',
                            title: '当前版本已保留',
                            detail: qualityHaltUserNotice,
                            status: 'error',
                            source: 'skill_executor',
                            audience: 'user',
                            visibility: 'user_process'
                        });
                        break;
                    }
                    requestPerformanceUsageSeed = currentPerformanceUsage;
                }

                reflexionReentryCount = reentryDecision.reentryCount;
                previousReflexionFailureSignature = reentryDecision.failureSignature;
                if (isCompletedAestheticImprovement) {
                    completedAestheticImprovementReentryUsed = true;
                }
                let reentryTitle = '继续调整当前版本';
                if (reflexionHandoff.sourceOwner === 'E2') {
                    reentryTitle = '继续完成交付';
                } else if (reflexionHandoff.sourceOwner === 'Runtime') {
                    reentryTitle = '继续完成尚未做完的部分';
                }
                agentCallbacks.onStep?.({
                    kind: 'observation',
                    title: reentryTitle,
                    detail: '正在根据刚才发现的问题继续优化画面。',
                    status: 'running',
                    source: 'skill_executor',
                    audience: 'user',
                    visibility: 'user_process'
                });
                const reentryTask = String(userTask);
                incomingReflexionHandoff = isCompletedAestheticImprovement
                    ? {
                        ...reflexionHandoff,
                        // completed 路径由 issueConstraints 携带 revision-bound 观察；清空同一
                        // finding 的二次投影，避免把 advisory feedback 叠成 Harness 指令。
                        failureAnalysis: [],
                        strategyAdjustments: [],
                        nextRoundConstraints: []
                    }
                    : {
                        ...reflexionHandoff,
                        nextRoundConstraints: reentryDecision.injectedConstraints.slice(0, 12)
                    };
                if (incomingReflexionHandoff) {
                    transferTrustedVisualReviewArtifact(result, incomingReflexionHandoff);
                }
                // 标记本次是失败复盘后的自动重跑，供后续运行记录与策略读取。
                runtimeParams.reflexionReentryInProgress = true;
                // V0-4：把上一轮 run-record checkpoint 的确定性旗标（documentCreated/layoutRendered）
                // 播种给下一轮纪律状态机——重入时 createExecuteToolWrapper 会新建全 false 的 disciplineState，
                // 不回灌就与续跑 brief 自相矛盾（brief 说文档已存在、纪律却强制 createDocument 旁建空文档）。
                // 累积并集（旗标只增不减）：与上一轮已有种子取 OR，避免"某轮工具日志无建档/排版→单轮派生退回
                // 全 false→下一轮病灶复现"的多轮衰减（对抗核验 finding）。派生纯读上一轮 result，无 IPC/FS 副作用。
                {
                    const derivedReflexionSeed = deriveReflexionDisciplineSeed(result);
                    const prevReflexionSeed = runtimeParams.reflexionDisciplineSeed as Partial<DesignDisciplineState> | undefined;
                    runtimeParams.reflexionDisciplineSeed = (prevReflexionSeed || derivedReflexionSeed)
                        ? {
                            documentCreated: Boolean(prevReflexionSeed?.documentCreated) || Boolean(derivedReflexionSeed?.documentCreated),
                            layoutRendered: Boolean(prevReflexionSeed?.layoutRendered) || Boolean(derivedReflexionSeed?.layoutRendered)
                        }
                        : undefined;
                }
                if (runtimeSessionIdentity) {
                    taskRunDocumentCreationEvidence = extendTaskRunDocumentCreationEvidence({
                        previous: taskRunDocumentCreationEvidence,
                        identity: runtimeSessionIdentity,
                        toolCallLog: buildAgentOperationLedger(result.toolCallLog || [])
                    });
                }
                // 被复盘取代的这一轮也要留档（失败轨迹是 Eval 的原料），并把 runId 链给下一轮
                const runRecordRuntimeIdentity = resolveRuntimeRunRecordIdentity(
                    runtimeContractBundle,
                    runtimeSessionIdentity
                );
                lastRunRecordId = persistAgentRunRecordSafely({
                    result,
                    userTask: String(userTask),
                    controlPlane: runtimeParams.agentIntentControlPlane,
                    projectPath: runRecordProjectPath,
                    conversationScope: runRecordConversationScope,
                    projectState: getFreshDesignProjectStateForRecord(),
                    parentRunId: runRecordRuntimeIdentity ? undefined : lastRunRecordId,
                    resumeFreshness: runResumeFreshness,
                    runtimeSessionIdentity: runRecordRuntimeIdentity,
                    runtimeContractStatus,
                    modelIdentity: runRecordModelIdentity
                });
                if (runtimeContractBundle) {
                    const previousSession = readRuntimeSessionFromAgentResult(result);
                    if (!previousSession || !runtimeSessionIdentity) {
                        throw new Error('runtime_session_generation_seed_missing');
                    }
                    if (previousSession.identity.runId !== runtimeSessionIdentity.runId) {
                        throw new Error('runtime_session_generation_result_identity_mismatch');
                    }
                    if (previousSession.stageState.status !== 'reflexion_required') {
                        qualityHaltNotice = '当前版本已经产生处理记录，但自动返工没有进入可安全承接的状态。已保留现有结果并停止继续写入，请先复核当前画面。';
                        qualityHaltUserNotice = '当前版本已保留。继续调整前需要先确认当前画面，请先看一下这版。';
                        break;
                    }
                    const nextAuthorization = await authorizeRuntimeArtifactFinalizationForProject({
                        projectPath: runRecordProjectPath,
                        requestId: createRuntimeSessionNonce(),
                        skillId: runtimeContractBundle.stagePlan.skillId,
                        taskType: runtimeContractBundle.stagePlan.taskType,
                        previousRunId: runtimeSessionIdentity.runId
                    });
                    if (runRecordProjectPath && !nextAuthorization) {
                        qualityHaltNotice = '当前版本已保留，但主进程未签发下一代 TaskRun 与 Artifact 授权。已停止自动返工，未在 Renderer 本地伪造新身份；请先复核当前画面和项目状态。';
                        qualityHaltUserNotice = '当前版本已保留。现在无法安全继续修改，请先确认当前画面和项目状态。';
                        break;
                    }
                    const nextIdentity = nextAuthorization
                        ? nextAuthorization.runtimeIdentity
                        : advanceRuntimeSessionIdentity({
                            previous: runtimeSessionIdentity,
                            now: new Date().toISOString(),
                            nonce: createRuntimeSessionNonce()
                        });
                    if (nextAuthorization) {
                        runtimeArtifactAuthorizationTokens.set(
                            nextAuthorization.runtimeIdentity.runId,
                            nextAuthorization.authorizationToken
                        );
                    }
                    const nextSession = advanceRuntimeSessionGeneration({
                        previous: previousSession,
                        identity: nextIdentity,
                        plan: runtimeContractBundle.stagePlan
                    });
                    runtimePlanningContextSeed = buildRuntimePlanningContextSeed({
                        previousSession,
                        nextSession,
                        plan: runtimeContractBundle.stagePlan,
                        declarations: readRuntimePlanningDeclarationsFromAgentResult(result)
                    });
                    runtimeSessionSeed = nextSession;
                    runtimeSessionIdentity = nextIdentity;
                }
                // 每个 Reflexion generation 都有独立运行记录；失败审计不得把上一代 Tool
                // 重新归到新的 runId。跨代累计只由 accumulatedSuccessfulMutationCalls 承担。
                runtimeActivity = createAutonomousAgentRuntimeActivity();
                publishDebugFinalArtifactPaths(guardedFinalDeliveryRequestId, []);
                activeAutonomousAgent = createAutonomousAgent();
                result = await activeAutonomousAgent.run(reentryTask, runtimeParams.images);
                captureGuardedFinalDeliveryArtifacts(result);
                accumulatedSuccessfulMutationCalls += countSuccessfulMutationCalls(result);
                await recordRunFactsToProjectStateSafely(result);
                await refreshGenerationDataContext(
                    resolveAutonomousDesignDisciplineContext(runtimeParams, context).active
                );
                await adoptOwnerConfirmedProjectStateFromRun(result);
                rebuildGenerationRuntimeContextItems();
                generationProjectStateRefreshAllowsReentry = canReenterAfterGenerationProjectStateRefresh({
                    hadSuccessfulStateUpdate: hasSuccessfulGenerationProjectStateUpdate(result.toolCallLog || []),
                    snapshotStatus: getDesignStateSnapshotStatus()
                });
            }

            if (result.cancelled) {
                // 取消也留档：中断轨迹是 H2 续跑与 Eval 的原料
                const runRecordRuntimeIdentity = resolveRuntimeRunRecordIdentity(
                    runtimeContractBundle,
                    runtimeSessionIdentity
                );
                persistAgentRunRecordSafely({
                    result,
                    userTask: String(userTask),
                    controlPlane: runtimeParams.agentIntentControlPlane,
                    projectPath: runRecordProjectPath,
                    conversationScope: runRecordConversationScope,
                    projectState: getFreshDesignProjectStateForRecord(),
                    parentRunId: runRecordRuntimeIdentity ? undefined : lastRunRecordId,
                    resumeFreshness: runResumeFreshness,
                    runtimeSessionIdentity: runRecordRuntimeIdentity,
                    runtimeContractStatus,
                    modelIdentity: runRecordModelIdentity
                });
                return buildCancelledAutonomousAgentResult(result);
            }

            const finalGenerationSuccessfulMutationCalls = countSuccessfulMutationCalls(result);
            const priorGenerationSuccessfulMutationCalls = Math.max(
                0,
                accumulatedSuccessfulMutationCalls - finalGenerationSuccessfulMutationCalls
            );
            const finalGenerationCompleted = result.success === true
                && result.executionSummary?.status === 'completed';
            const mutationCarryoverNotice = priorGenerationSuccessfulMutationCalls > 0
                && !finalGenerationCompleted
                ? '当前版本已经有画面或文件改动，但后续复核还没完成。已停止自动重放，请先查看当前文档。'
                : undefined;
            if (reflexionReentryCount > 0 || priorGenerationSuccessfulMutationCalls > 0) {
                result = {
                    ...result,
                    ...(mutationCarryoverNotice
                        ? { message: [result.message, mutationCarryoverNotice].filter(Boolean).join('\n\n') }
                        : {}),
                    data: {
                        ...(result.data || {}),
                        reflexionMutationSummary: {
                            totalSuccessfulMutationCalls: accumulatedSuccessfulMutationCalls,
                            priorGenerationSuccessfulMutationCalls,
                            finalGenerationSuccessfulMutationCalls,
                            changedAcrossRun: accumulatedSuccessfulMutationCalls > 0
                        }
                    }
                };
            }

            const finalRunRecordRuntimeIdentity = resolveRuntimeRunRecordIdentity(
                runtimeContractBundle,
                runtimeSessionIdentity
            );
            const finalRunRecordId = persistAgentRunRecordSafely({
                result,
                userTask: String(userTask),
                controlPlane: runtimeParams.agentIntentControlPlane,
                projectPath: runRecordProjectPath,
                conversationScope: runRecordConversationScope,
                projectState: getFreshDesignProjectStateForRecord(),
                parentRunId: finalRunRecordRuntimeIdentity ? undefined : lastRunRecordId,
                resumeFreshness: runResumeFreshness,
                runtimeSessionIdentity: finalRunRecordRuntimeIdentity,
                runtimeContractStatus,
                modelIdentity: runRecordModelIdentity
            });

            const designRunRecord = effectiveDesignDisciplineContext.active
                ? deriveDesignTaskRunRecord({
                    executionCompleted: result.executionSummary?.status === 'completed',
                    overallSuccess: result.success === true,
                    label: effectiveDesignDisciplineContext.label,
                    deliveryRequired: requiresDesignRunDelivery(normalizeRuntimeDesignWorkMode(
                        runtimeContractBundle?.stagePlan.expectedWorkMode
                            || runtimeParams?.declaredWorkMode
                    )),
                    toolEntries: (result.toolCallLog || []).map((entry) => ({
                        name: entry.name,
                        succeeded: entry.result?.success !== false,
                        isPhotoshopMutation:
                            classifyAgentToolExecution(entry.name, entry.arguments) === 'photoshop_write',
                        visualReviewed: resolveVisualReviewedForDiscipline(entry.result, entry.name),
                        result: entry.result
                    }))
                })
                : undefined;
            const runtimeTaskSnapshot = readRuntimeTaskSnapshot((
                result.data as Record<string, unknown> | undefined
            )?.runtimeTaskSnapshot);
            if (qualityHaltNotice) {
                console.warn('[AutonomousAgent] 自动调整停止:', qualityHaltNotice);
            }
            registerRuntimeInteractiveCheckpointFromAgentResult({
                result,
                sourceTask: runtimeInteractiveReentry?.sourceTask || String(userTask),
                plan: runtimeContractBundle?.stagePlan,
                authorizationTokens: runtimeArtifactAuthorizationTokens
            });
            return {
                success: result.success,
                // 运行诊断留在内部日志；用户结果只说明当前版本和下一步，不承担成本、代际或轮次解释。
                message: qualityHaltUserNotice ? `${result.message}\n\n${qualityHaltUserNotice}` : result.message,
                error: result.error,
                data: {
                    ...(designRunRecord ? {
                        status: designRunRecord.status,
                        canClaimOutputQuality: designRunRecord.canClaimOutputQuality,
                        outputCount: designRunRecord.outputCount,
                        warnings: designRunRecord.warnings,
                        designRunRecord
                    } : {}),
                    // 透传自主循环停在确认点时的交互卡片，让 UI 渲染并等待用户确认——不自动确认。
                    ...(Array.isArray((result as any).data?.interactiveCards) && (result as any).data.interactiveCards.length > 0 ? {
                        interactiveCards: (result as any).data.interactiveCards,
                        awaitingUserConfirmation: (result as any).data.awaitingUserConfirmation === true,
                        ...((result as any).data.pendingInteractiveContinuation ? {
                            pendingInteractiveContinuation: (result as any).data.pendingInteractiveContinuation
                        } : {})
                    } : {}),
                    ...((result as any).data?.userChoiceRequest?.version === 'user-choice-request/v2' ? {
                        userChoiceRequest: (result as any).data.userChoiceRequest
                    } : {}),
                    // DI-009：任务知识上下文只读展示卡片（不进入确认态，仅展示）。
                    ...(taskContextInteractiveCard ? {
                        interactiveCards: [
                            ...(Array.isArray((result as any).data?.interactiveCards) ? (result as any).data.interactiveCards : []),
                            taskContextInteractiveCard
                        ]
                    } : {}),
                    iterations: result.iterations,
                    stopReason: result.stopReason,
                    executionSummary: result.executionSummary,
                    toolCallLog: result.toolCallLog,
                    performanceBudget: runtimeBudget,
                    runtimeContextCompilation: {
                        version: compiledRuntimeContext.version,
                        includedItemIds: compiledRuntimeContext.includedItemIds,
                        rejectedItemIds: compiledRuntimeContext.rejectedItemIds,
                        issues: compiledRuntimeContext.issues,
                        metrics: compiledRuntimeContext.metrics,
                        boundaries: compiledRuntimeContext.boundaries
                    },
                    runtimeContractStatus,
                    ...(result.executionSummary?.runtimeSessionDigest
                        ? { runtimeSessionDigest: result.executionSummary.runtimeSessionDigest }
                        : {}),
                    ...(runtimeTaskSnapshot ? { runtimeTaskSnapshot } : {}),
                    capabilityResolution: capabilitySession.getResolution(),
                    ...(runResumeFreshness ? { actionPlanResumeFreshness: runResumeFreshness } : {}),
                    // Harness v1：本轮运行记录引用（完整记录在 <project>/.designecho/runs/<runId>.json）
                    ...(finalRunRecordId ? {
                        runRecordRef: {
                            runId: finalRunRecordId,
                            ...(finalRunRecordRuntimeIdentity ? {
                                sessionId: finalRunRecordRuntimeIdentity.sessionId,
                                generation: finalRunRecordRuntimeIdentity.generation
                            } : {})
                        }
                    } : {})
                }
            };
        } catch (error: any) {
            publishDebugFinalArtifactPaths(guardedFinalDeliveryRequestId, []);
            console.error('[AutonomousAgent] runtime failure:', error);
            // Provider 中断也可能发生在已完成 Project State / Photoshop 写入之后。
            // 失败记录与正常代使用同一代际刷新；loader 自身保留 last-good 且不覆盖原始异常。
            await recordRunFactsToProjectStateSafely({ toolCallLog: runtimeActivity.completedToolCalls });
            await refreshGenerationDataContext(
                resolveAutonomousDesignDisciplineContext(runtimeParams, context).active
            );
            await adoptOwnerConfirmedProjectStateFromRun({
                toolCallLog: runtimeActivity.completedToolCalls
            });
            const rawFailure = String(error?.message || 'unknown_runtime_failure');
            if (error instanceof ModelProviderCallError) {
                const modelConfig = findConfiguredModelInRendererState(error.modelId);
                const modelLabel = modelConfig?.name || error.modelId;
                const toolCallsStarted = runtimeActivity.startedToolNames.length > 0;
                const failedBeforeFirstToolCall = runtimeActivity.modelResponsesCompleted === 0
                    && !toolCallsStarted;
                const successfulMutationCalls = countSuccessfulMutationCalls({
                    toolCallLog: runtimeActivity.completedToolCalls
                });
                const priorGenerationSuccessfulMutationCalls = accumulatedSuccessfulMutationCalls;
                const totalObservedSuccessfulMutationCalls = priorGenerationSuccessfulMutationCalls
                    + successfulMutationCalls;
                let activityMessage: string;
                if (failedBeforeFirstToolCall && priorGenerationSuccessfulMutationCalls === 0) {
                    activityMessage = '设计助手还没开始处理文件，这次没有修改 Photoshop 文档。';
                } else if (failedBeforeFirstToolCall) {
                    activityMessage = '设计助手在继续调整前停下了，之前的画面或文件改动已经保留；下次继续时会先读取当前文档，再从已有结果接着做。';
                } else if (successfulMutationCalls > 0) {
                    activityMessage = '设计助手在任务中途停下了，已经完成的画面或文件改动已保留；下次继续时会先读取当前文档，避免整项重做。';
                } else if (toolCallsStarted && priorGenerationSuccessfulMutationCalls > 0) {
                    activityMessage = '设计助手在处理途中停下了，当前结果还不完整；之前的改动已保留，下次会先读取当前文档再继续。';
                } else if (toolCallsStarted) {
                    activityMessage = '设计助手在处理途中停下了，当前结果还不完整；下次会自行读取当前文档后再继续。';
                } else if (priorGenerationSuccessfulMutationCalls > 0) {
                    activityMessage = '这次还没开始新的处理，之前的画面或文件改动已经保留；下次会从当前文档状态接着做。';
                } else {
                    activityMessage = '设计助手在开始处理文件前停下了。';
                }
                const availabilityMessage = isHarnessManagedSubscriptionTimeout(error.providerFailure)
                    ? '这次处理等待时间过长，DesignEcho 已停止继续等待；这不代表模型能力不足。'
                    : buildConversationalUnavailableMessage({
                        audience: 'general',
                        kind: error.providerFailure.kind,
                        failedModelLabel: modelLabel
                    });
                const safeMessage = [
                    availabilityMessage,
                    activityMessage
                ].join('');
                const runtimeFailureCode = `model_provider_${error.providerFailure.kind}`;
                const completedToolCalls = runtimeActivity.completedToolCalls;
                const successfulToolCalls = completedToolCalls.filter((entry) => entry.result?.success !== false);
                const failedToolCalls = completedToolCalls.length - successfulToolCalls.length;
                const observedToolCallCount = successfulToolCalls.filter((entry) => (
                    classifyAgentToolExecution(entry.name, entry.arguments) === 'read_only_observation'
                )).length;
                const acceptanceResults = completedToolCalls
                    .map((entry) => entry.result?.acceptance)
                    .filter(Boolean);
                const runtimeAccountingDigest = activeAutonomousAgent?.readRuntimeAccountingDigest();
                const failureExecutionSummary: AgentExecutionSummary = {
                    status: 'failed',
                    stopReason: 'error',
                    iterations: runtimeActivity.iterationsCompleted,
                    toolCallCount: completedToolCalls.length,
                    successfulToolCalls: successfulToolCalls.length,
                    failedToolCalls,
                    successfulMutationCalls,
                    observedToolCallCount,
                    acceptanceVerified: acceptanceResults.filter((item) => item?.verified === true).length,
                    acceptanceFailed: acceptanceResults.filter((item) => item?.toolSucceeded === false).length,
                    acceptanceNeedsReview: acceptanceResults.filter((item) => (
                        item?.verified !== true && item?.toolSucceeded !== false
                    )).length,
                    noDocumentChangeRisks: acceptanceResults.filter((item) => (
                        item?.noDocumentChangeRisk === true
                    )).length,
                    ...(completedToolCalls.length > 0 ? {
                        lastToolName: completedToolCalls[completedToolCalls.length - 1]?.name,
                        ...(completedToolCalls[completedToolCalls.length - 1]?.result?.error ? {
                            lastError: String(completedToolCalls[completedToolCalls.length - 1]?.result?.error)
                        } : {})
                    } : {}),
                    blockers: [runtimeFailureCode],
                    warnings: toolCallsStarted
                        ? ['Provider 中断后的工具日志只包含已经返回结果的调用；当前任务不能确认完整。']
                        : [],
                    summaryText: safeMessage
                };
                const failedRunRecordRuntimeIdentity = resolveRuntimeRunRecordIdentity(
                    runtimeContractBundle,
                    runtimeSessionIdentity
                );
                const failedRunRecordId = persistAgentRunRecordSafely({
                    result: {
                        success: false,
                        iterations: runtimeActivity.iterationsCompleted,
                        stopReason: 'model_provider_failure',
                        toolCallLog: runtimeActivity.completedToolCalls,
                        executionSummary: {
                            status: failedBeforeFirstToolCall
                                ? 'failed_before_tool_call'
                                : 'failed_after_partial_activity',
                            blockers: [runtimeFailureCode],
                            warnings: toolCallsStarted
                                ? ['Provider 中断后的工具日志来自 Runtime 回调，仅包含已完成调用的名称与结果。']
                                : [],
                            successfulMutationCalls,
                            modelProviderFailureDigest: {
                                version: 'model-provider-failure-digest/v0',
                                kind: error.providerFailure.kind,
                                basis: error.providerFailure.basis,
                                modelId: error.modelId,
                                ...(error.providerFailure.status ? {
                                    status: error.providerFailure.status
                                } : {}),
                                ...(error.providerFailure.providerCode ? {
                                    providerCode: error.providerFailure.providerCode
                                } : {}),
                                diagnostic: error.providerFailure.diagnostic
                            },
                            ...(runtimeAccountingDigest
                                ? { runtimeAccountingDigest }
                                : {})
                        }
                    },
                    userTask: String(userTask),
                    controlPlane: runtimeParams.agentIntentControlPlane,
                    projectPath: runRecordProjectPath,
                    conversationScope: runRecordConversationScope,
                    projectState: getFreshDesignProjectStateForRecord(),
                    parentRunId: failedRunRecordRuntimeIdentity ? undefined : lastRunRecordId,
                    resumeFreshness: runResumeFreshness,
                    runtimeSessionIdentity: failedRunRecordRuntimeIdentity,
                    runtimeContractStatus,
                    modelIdentity: runRecordModelIdentity
                });
                return {
                    success: false,
                    message: safeMessage,
                    error: safeMessage,
                    data: {
                        runtimeFailureCode,
                        modelProviderFailure: {
                            kind: error.providerFailure.kind,
                            basis: error.providerFailure.basis,
                            ...(error.providerFailure.status ? { status: error.providerFailure.status } : {}),
                            ...(error.providerFailure.providerCode ? {
                                providerCode: error.providerFailure.providerCode
                            } : {}),
                            modelId: error.modelId,
                            diagnostic: error.providerFailure.diagnostic
                        },
                        toolCallsStarted,
                        toolCallsStartedCount: runtimeActivity.startedToolNames.length,
                        modelCallsStarted: runtimeActivity.modelCallsStarted,
                        modelResponsesCompleted: runtimeActivity.modelResponsesCompleted,
                        iterationsCompleted: runtimeActivity.iterationsCompleted,
                        executionSummary: failureExecutionSummary,
                        toolCallLog: completedToolCalls,
                        priorGenerationSuccessfulMutationCalls,
                        currentGenerationSuccessfulMutationCalls: successfulMutationCalls,
                        totalObservedSuccessfulMutationCalls,
                        ...(failedBeforeFirstToolCall && totalObservedSuccessfulMutationCalls === 0
                            ? { photoshopWriteOccurred: false }
                            : {}),
                        ...(totalObservedSuccessfulMutationCalls > 0
                            ? { photoshopWriteOccurred: true }
                            : {}),
                        ...(failedRunRecordId ? {
                            runRecordRef: { runId: failedRunRecordId }
                        } : {})
                    }
                };
            }
            // 多主选择歧义是用户可立即修正的输入问题：把可操作文案直接给用户，
            // 不埋进笼统的"运行异常"里。
            const ambiguousSelection = /^operating_context_ambiguous_primary_selection[:：](.*)$/.exec(rawFailure);
            if (ambiguousSelection) {
                const safeMessage = ambiguousSelection[1]?.trim()
                    || '同时选中了多个主目标（工作流节点、项目素材或 Eagle 素材），请只保留一个目标后重试。';
                return {
                    success: false,
                    message: safeMessage,
                    error: safeMessage,
                    data: {
                        runtimeFailureCode: rawFailure
                    }
                };
            }
            // 兜底分支：这里的 rawFailure 是**没能被 classifyModelProviderFailure 归类**的失败。
            // 原先整条丢弃、只写进 data.runtimeFailureCode，界面上只剩一句「运行异常」——
            // 真机 2026-08-28：真实原因是「模型 google/gemini-3.7-flash:batch 不存在」，
            // 用户面对的却是无从下手的笼统提示，只能靠翻日志才知道该换模型。
            //
            // 归类失败不等于原因不可读：provider 与 Harness 抛出的多数 message 本身
            // 就是给人看的中文。这里复用与 buildAgentIterationFailureMessage 相同的清洗
            // （去工具标记、脱敏本地路径、改写实现向术语），把可读部分接在状态说明后面。
            // 清洗后为空（纯内部标识符、噪声）时才退回原来的笼统文案。
            const failureDetail = sanitizeUserVisibleDiagnosticText(rawFailure);
            const stateNotice = '当前结果不能确认完成。为避免继续改动画面，已停止执行；下次继续时会先读取当前文档状态。';
            const safeMessage = failureDetail
                ? `处理中断：${failureDetail}

${stateNotice}`
                : `处理过程中出现运行异常，${stateNotice}`;
            return {
                success: false,
                message: safeMessage,
                error: safeMessage,
                data: {
                    runtimeFailureCode: rawFailure
                }
            };
        }
    }
};
