/**
 * 对话面板
 * 参考 Lovart (https://lovart.ai) 和 Manus (https://manus.im) 的设计理念
 * 
 * 重构说明：
 * - 业务逻辑已抽离到 useChatActions Hook
 * - 本文件主要负责 UI 渲染和状态管理
 */

import React, {
    useRef,
    useEffect,
    useLayoutEffect,
    useState,
    useCallback,
    useMemo
} from 'react';
import {
    BookOpen,
    Camera,
    FolderOpen,
    Images,
    Monitor,
    Plus,
    Upload,
    X
} from 'lucide-react';
import { useAppStore } from '../stores/app.store';
import { SuggestionList, TextSuggestion } from './SuggestionList';
import { ReferenceUpload } from './ReferenceUpload';
import { ReferenceReplicator } from './ReferenceReplicator';
import { LayoutFixList, LayoutFix } from './LayoutFixList';
import { ThinkingModeControl } from './ThinkingModeControl';
import { DecisionModeControl } from './DecisionModeControl';
import { SkillPickerControl } from './SkillPickerControl';
import { getSkillById } from '../../shared/skills/skill-declarations';
import { ThinkingProcess, ThinkingStep } from './ThinkingProcess';
import { DesignTaskCardBlock } from './message/blocks/DesignTaskCardBlock';
import { getActiveDesignTaskCard } from '../services/design-workshop/design-task-card.store';
import { resolveCurrentDesignTaskItemId, type DesignTaskCard } from '../../shared/design-task-card';
import { ConversationManager } from './ConversationManager';
import './ThinkingProcess.css';

// 多模态消息渲染
import { MessageRenderer, convertLegacyMessage } from './message';
import type { MultimodalMessage } from './message';
import type { AssetSelectionContext } from './AssetGallery';
import {
    InlineMultimodalComposer,
    type InlineMultimodalComposerHandle,
    type InlineMultimodalComposerSnapshot
} from './chat/InlineMultimodalComposer';
import type { EagleLibrarySelectionContext } from '../../shared/eagle-library';
import type { EagleAssetRef } from '../../shared/eagle-asset-ref';
import {
    EAGLE_COMPOSER_DRAG_MIME,
    normalizeEagleComposerAssetRefs,
    parseEagleComposerDragPayload,
    type EagleComposerInsertRequest
} from '../../shared/eagle-composer-transfer';
import type { WorkflowSelectionContext } from './WorkflowBoard';
import type { ContentBlock as AgentContentBlock } from '../services/agent-runtime/types';
import { KNOWLEDGE_REFERENCE_USE_ROLES, type KnowledgeSelectionReference } from '../../shared/knowledge-selection-context';
import {
    buildChatComposerModelText,
    buildChatComposerPlainText,
    buildChatComposerReferenceMarker,
    cloneChatComposerReference,
    normalizeChatComposerContentParts,
    stripChatComposerReferenceMarkers,
    type ChatComposerContentPart,
    type ChatComposerReference,
    type ChatMessageImage
} from '../../shared/chat-composer-content';

// 从工具执行服务导入核心功能
import { executeToolCall } from '../services/tool-executor.service';
import { submitVisualObservationCardAction } from '../../shared/agent-runtime-v5/detail-page-card-controller';
import {
    resolvePendingDestructiveActionSubmission,
    type PendingDestructiveActionCard
} from '../../shared/pending-destructive-action-card';
import type { VisualObservationBlockedCard } from '../../shared/agent-runtime-v5/visual-observation-card';
import {
    buildOperatingContextSnapshot,
    resolveOperatingPhotoshopConnection,
    type OperatingWorkflowContext
} from '../../shared/agent-runtime-v5/operating-context-snapshot';
import { resolveMaterialSelectionReasonProjection } from '../../shared/design-workshop/compose-design-rationale-visibility';
import {
    createGuardedPhotoshopExecutionBaseline,
    readGuardedPhotoshopExecutionBaselineReceipt,
    type GuardedPhotoshopExecutionBaseline
} from '../../shared/guarded-photoshop-execution-baseline';
// 保留 useChatActions Hook 的模型选择功能
import { useChatActions } from '../hooks/useChatActions';
import {
    createDesignImageInput,
    injectImagesIntoLastUserMessage,
    type DesignImageInput
} from '../../shared/design-image-input';
import { buildAgentResumeReadonlyToolHandlers } from '../services/agent-orchestration/resume-readonly-handlers';
import { createPublicPlanPhotoshopAdapter } from '../services/agent-orchestration/public-plan-photoshop-adapter';
import {
    beginDebugFinalArtifactCapture,
    clearDebugFinalArtifactCapture,
    readDebugFinalArtifactPaths,
    readDebugSkuDeliverySource
} from '../services/debug-final-artifact-sidecar';
import {
    buildDebugBridgeChatExecutionFailure,
    buildDebugBridgeChatFailureEnvelope,
    debugBridgePhotoshopRuntimeLiveIdentitiesMatch,
    DEBUG_BRIDGE_CHAT_PREFLIGHT_VERSION,
    readDebugBridgePhotoshopRuntimeBinding,
    readDebugBridgePhotoshopRuntimeLiveIdentity,
    type DebugBridgeChatExecutionStage,
    type DebugBridgePhotoshopRuntimeLiveIdentity
} from '../../shared/debug-bridge-chat';
import { getEagleLibraryPreview } from '../services/eagle-library.service';

// 导入统一 AI Agent 服务
import { 
    processWithUnifiedAgent, 
    debugInferDecisionFromText,
    capturePhotoshopRequestContext,
    getProjectContext,
    type AgentContext,
    type AgentUserVisibleNotice
} from '../services/unified-agent.service';
import type { AgentExecutionSummary, AgentStepEvent } from '../services/agent-runtime/types';
import {
    buildAgentDiagnosticRecord,
    type AgentDiagnosticRecord
} from '../../shared/agent-diagnostic-record';
import {
    formatAssistantBusinessVisualFeedbackContent,
    formatAssistantFailureContent,
    sanitizeUserVisibleAgentText,
    sanitizeUserVisibleAssistantBodyText,
    sanitizeUserVisibleDiagnosticText,
    sanitizeUserVisibleThinkingText,
    finalizeUserVisibleThinkingText
} from '../../shared/chat-response-cleaner';
import { sanitizeUiActionToolParams } from '../../shared/ui-action-tool-params';
import {
    extractRuntimeOperationRequestsFromPublicPlanExecutionRequest,
    stripRuntimeParamsFromPublicPlanExecutionRequest,
    type AgentTaskPublicPlanControlledOperationRequest,
    type AgentTaskPublicPlanExecutionRequest
} from '../../shared/agent-task-public-plan-execution-request';
import {
    stripRuntimeParamsFromPublicPlanControlledRun,
    type AgentTaskPublicPlanControlledRun
} from '../../shared/agent-task-public-plan-controlled-runner';
import type { AgentRequestLifecycleRecord } from '../../shared/agent-request-lifecycle';
import {
    buildAgentTaskPlanPresentation,
    type AgentTaskPlanPresentation
} from '../../shared/agent-task-plan-presentation';
import { readRuntimeTaskSnapshot } from '../../shared/agent-runtime-v5/runtime-task-snapshot';
import { readPhotoshopOperationResult } from '../../shared/photoshop-operation-result';
import {
    buildUserStoppedResponseInterruption,
    isAgentResponseInterruptionSentinelContent,
    resolveAgentResponseInterruption
} from '../../shared/agent-response-interruption';
import { decideAgentRunResultDisposition } from '../../shared/agent-run-result-disposition';
import {
    normalizeDebugFinalArtifactRefs,
    normalizeDebugSkuDeliveryEvidence
} from '../../shared/debug-final-artifact-refs';
import { resolveAgentExecutionPresentationDisposition } from '../../shared/agent-completion-message-consistency';
import type { BusinessSkillVisualObservationFeedback } from '../../shared/business-skill-visual-observation-feedback';
import type { SkuDeliverySummary } from '../../shared/sku-delivery-summary';
import {
    deterministicBlockerReplyOrigin,
    modelAuthoredReplyOrigin,
    testFixtureReplyOrigin,
    toolSummaryReplyOrigin,
    uiStatusReplyOrigin,
    type AssistantReplyOrigin
} from '../../shared/assistant-reply-origin';
import {
    canObservationEnterThinkingSteps,
    classifyAgentObservationChannel
} from '../../shared/agent-observation-channels';
import { isSimpleDeterministicShortPathSkill } from '../../shared/agent-route-boundary-policy';
import {
    callPhotoshopMcpTool,
    getPhotoshopConnectionStatus,
    listPhotoshopMcpTools
} from '../services/mcp-host.client';
import { streamChatAsync } from '../services/stream-chat.service';
import { canUsePlainTextProviderStream } from '../services/agent-orchestration/streaming-policy';
import { summarizeChatError } from '../services/agent-orchestration/chat-error-summary';
import {
    getModelPriorityForConversationTask,
    getModelRecoveryPriorityForConversationTask,
    resolveConversationTaskTypeForModelPurpose,
    type ConversationTaskType
} from '../../shared/model-selection';
import { hasExplicitGeneratedPublicPlanApproval } from '../../shared/generated-public-plan-approval-policy';
import {
    buildProviderNativeToolPlan,
    type ProviderNativeToolRequest
} from '../../shared/provider-native-tools';
import {
    formatChatWebSearchCompletedStep,
    formatChatWebSearchVisibleStep,
    resolveChatWebSearchIntent,
    toProviderNativeWebSearchIntent,
    type ChatWebSearchIntent
} from '../../shared/chat-web-search-policy';
import {
    buildVisibleAgentActivityFromModelTurnEvent,
    buildVisibleAgentActivityFromProgress,
    buildVisibleAgentActivityFromRunPhase,
    buildVisibleAgentActivityFromStepEvent,
    isModelTurnFinishedEvent,
    formatAgentProcessEventContent,
    formatAgentToolEventContent,
    getVisibleAgentProcessStepType,
    isVisibleAgentStepEvent,
    isVisibleAgentProcessEvent,
    isVisiblePonderingStep,
    type VisibleAgentActivity
} from '../services/agent-visible-feedback';
import { getToolDisplayInfo } from '../services/tool-display-info';
import { getMemoryService } from '../services/memory.service';
import {
    claimInteractiveContinuationOperation,
    getInteractiveContinuationOperation,
    markInteractiveContinuationOperationUnknown
} from '../services/interactive-continuation-operation-client';
import {
    loadPublicPlanOperationVault,
    removePublicPlanOperationVault,
    savePublicPlanOperationVault
} from '../services/public-plan-operation-vault';
import type { InteractiveContinuationOperationIdentity } from '../../shared/interactive-continuation-operation';
import {
    buildInteractiveCardSubmission,
    buildInteractiveCardSubmissionInstanceKey,
    cleanInteractiveCardText,
    type InteractiveCardDefinition,
    type InteractiveCardSubmission
} from '../../shared/interactive-card-contract';
import {
    buildAgentInternalResumeRequest,
    resolveInteractiveReviewResumeContext,
    type AgentInternalResumeKind,
    type AgentInternalResumeRequest
} from '../../shared/interactive-review-resume';
import {
    buildInteractiveCardSubmissionDecision,
    type InteractiveContinuationRequest,
    type PendingInteractiveContinuation
} from '../../shared/pending-interactive-continuation';
import {
    buildEditableConfirmationApprovedMemory,
    validateEditableConfirmationValue,
    type EditableConfirmationCard,
    type EditableConfirmationValue
} from '../../shared/editable-confirmation-interactive-card';
import {
    normalizeSkillInteractiveCardAction,
    prepareSkillInteractiveCardSubmission,
    prepareSkillInteractiveReview
} from '../services/skill-executors/interaction-cards/registry';
import {
    buildDesignProjectFactReviewPatch,
    doesDesignProjectFactReviewCardMatchState,
    getDesignProjectFactReviewCardSummary,
    isDesignProjectFactReviewCard,
    validateDesignProjectFactReviewCardValue
} from '../../shared/design-project-fact-review-card';
import {
    buildDesignProjectRuleReviewPatch,
    doesDesignProjectRuleReviewCardMatchState,
    getDesignProjectRuleReviewCardSummary,
    isDesignProjectRuleReviewCard,
    validateDesignProjectRuleReviewCardValue
} from '../../shared/design-project-rule-review-card';

// 导入模型配置
import {
    getModelById,
    isAgentMultimodalModelId,
    isModelThinkingUserControllable,
    normalizeModelRunMode,
    resolveModelContextWindow,
    normalizeModelThinkingPreference,
    resolveModelThinkingEnabledForCall,
    type ModelPreferences
} from '../../shared/config/models.config';
// Agent 模型候选列表（与设置页「Agent 模型」同一口径，见模块头注释）
import { buildAllPrimaryModelOptionGroups } from '../../shared/config/primary-model-options';
import { ModelPicker } from './ModelPicker';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import {
    buildContextWindowUsage,
    estimateTextTokens,
    estimateToolSchemaTokens
} from '../../shared/context-window-usage';
import { buildConversationHistoryBudget } from '../../shared/agent-context-allocation';
import { selectAgentConversationContext } from '../../shared/agent-conversation-context';
import { buildAgentContextWindowBudget } from '../../shared/agent-performance-policy';
import { getDefaultAgentTools } from '../services/agent-runtime/tool-schemas';

type PhotoshopMcpToolsListPayload = {
    tools?: unknown[];
    result?: { tools?: unknown[] };
};

type ChatSendOverride = {
    text?: string;
    image?: { data: string; type: string } | null;
    publicPlanConfirmationSourceMessageId?: string;
    publicPlanConfirmationRequestId?: string;
    publicPlanDisposableLiveAdapter?: boolean;
    interactiveContinuationRequest?: InteractiveContinuationRequest;
    expectedConversationId?: string;
    expectedProjectId?: string;
    expectedProjectPath?: string;
    /** 仅受控 disposable Debug 请求内部传递，不进入模型参数。 */
    guardedPhotoshopExecutionBaseline?: GuardedPhotoshopExecutionBaseline;
    /** 确定性确认完成后的结构化承接；不伪装成用户重复发送原需求。 */
    internalResumeRequest?: AgentInternalResumeRequest;
    /** 已发送用户消息的气泡内编辑提交；它拥有独立草稿，不读取底部 Composer 实时状态。 */
    inlineMessageEdit?: InlineMessageEditSubmission;
};

function readDebugPhotoshopRuntimeIdentity(
    value: unknown
): DebugBridgePhotoshopRuntimeLiveIdentity | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const state = (value as any).state;
    const runtime = state && typeof state === 'object' && !Array.isArray(state)
        ? state.runtime
        : undefined;
    return readDebugBridgePhotoshopRuntimeLiveIdentity(runtime);
}

type ComposerRuntimeReference =
    | {
        kind: 'project_asset';
        context: AssetSelectionContext;
    }
    | {
        kind: 'eagle_asset';
        context: EagleLibrarySelectionContext;
    }
    | {
        kind: 'eagle_asset_ref';
        context: EagleAssetRef;
    }
    | {
        kind: 'knowledge_selection';
        context: KnowledgeSelectionReference;
    }
    | {
        kind: 'uploaded_image';
        imageId: string;
    };

interface FrozenComposerSubmission {
    parts: ChatComposerContentPart[];
    images: DesignImageInput[];
    selectedAssetContext?: AssetSelectionContext;
    selectedEagleLibraryAsset?: EagleLibrarySelectionContext;
    selectedEagleAssetGroup?: EagleAssetRef[];
    knowledgeReferences: KnowledgeSelectionReference[];
}

const MAX_COMPOSER_IMAGES = 5;
const MAX_COMPOSER_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_COMPOSER_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;

function estimateBase64PayloadBytes(data: string): number {
    const normalized = String(data || '')
        .replace(/^data:[^;,]+;base64,/i, '')
        .replace(/\s/g, '');
    if (!normalized) return 0;
    const padding = normalized.endsWith('==') ? 2 : (normalized.endsWith('=') ? 1 : 0);
    return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function validateFrozenComposerImageBudget(images: readonly DesignImageInput[]): string | null {
    if (images.length > MAX_COMPOSER_IMAGES) {
        return `一次消息最多附加 ${MAX_COMPOSER_IMAGES} 张图片，当前共有 ${images.length} 张。`;
    }
    let totalBytes = 0;
    for (const image of images) {
        const imageBytes = estimateBase64PayloadBytes(image.data);
        if (imageBytes > MAX_COMPOSER_IMAGE_FILE_BYTES) {
            return `图片“${image.name || '未命名图片'}”超过单张 8 MB 限制，请压缩后重新附加。`;
        }
        totalBytes += imageBytes;
    }
    if (totalBytes > MAX_COMPOSER_IMAGE_TOTAL_BYTES) {
        return '本条消息的图片总大小超过 20 MB，请移除或压缩部分图片后再发送。';
    }
    return null;
}

interface ComposerEditableMessage {
    id: string;
    content: string;
    contentParts?: ChatComposerContentPart[];
    images?: ChatMessageImage[];
    image?: { data: string; type: string };
}

interface InlineMessageEditSubmission {
    messageId: string;
    parts: ChatComposerContentPart[];
    images: DesignImageInput[];
    runtimeReferences: ReadonlyMap<string, ComposerRuntimeReference>;
}

interface MessageEditSession {
    messageId: string;
    conversationId: string;
    projectId: string;
    projectPath: string;
    initialParts: ChatComposerContentPart[];
    previewUrls: Record<string, string>;
    warning: string;
    truncatesFollowingMessages: boolean;
}

function isSupportedComposerImageType(value: string): boolean {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'image/jpeg'
        || normalized === 'image/png'
        || normalized === 'image/webp';
}

function createComposerReferenceId(kind: string): string {
    return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function resolveEagleComposerMediaKind(
    fileKind: EagleAssetRef['fileKind']
): ChatComposerReference['mediaKind'] {
    switch (fileKind) {
        case 'image':
            return 'image';
        case 'video':
            return 'video';
        case 'design':
            return 'design_document';
        case 'font':
            return 'font';
        case 'document':
            return 'document';
        default:
            return 'other';
    }
}

function toChatMessageImages(images: readonly DesignImageInput[]): ChatMessageImage[] {
    return images.map((image) => ({
        id: image.id,
        data: image.data,
        type: image.mediaType,
        ...(image.name ? { name: image.name } : {})
    }));
}

function cloneEagleAssetRef(assetRef: EagleAssetRef): EagleAssetRef {
    return {
        ...assetRef,
        tags: [...assetRef.tags],
        folderPaths: [...assetRef.folderPaths]
    };
}

function cloneEagleLibrarySelectionContext(
    context: EagleLibrarySelectionContext
): EagleLibrarySelectionContext {
    return {
        ...context,
        assetRef: cloneEagleAssetRef(context.assetRef),
        tags: [...context.tags],
        folderPaths: [...context.folderPaths]
    };
}

function buildSafeProjectAssetPath(projectPath: string, relativePath: string): string | undefined {
    const projectRoot = String(projectPath || '').trim().replace(/[\\/]+$/, '');
    const segments = String(relativePath || '')
        .trim()
        .split(/[\\/]+/)
        .filter((segment) => segment && segment !== '.');
    if (!projectRoot || segments.length === 0 || segments.some((segment) => segment === '..')) {
        return undefined;
    }
    return `${projectRoot}\\${segments.join('\\')}`;
}

function buildPersistedComposerRuntimeReferences(
    parts: readonly ChatComposerContentPart[],
    projectPath: string
): Map<string, ComposerRuntimeReference> {
    const references = new Map<string, ComposerRuntimeReference>();
    for (const part of parts) {
        if (part.type !== 'reference') continue;
        const source = part.reference.source;
        if (source.kind === 'uploaded_image') {
            references.set(part.reference.referenceId, {
                kind: 'uploaded_image',
                imageId: source.imageId
            });
            continue;
        }
        if (source.kind === 'eagle_asset') {
            references.set(part.reference.referenceId, {
                kind: 'eagle_asset_ref',
                context: cloneEagleAssetRef(source.assetRef)
            });
            continue;
        }
        if (source.kind === 'knowledge_selection' && source.selection) {
            references.set(part.reference.referenceId, {
                kind: 'knowledge_selection',
                context: {
                    ...source.selection,
                    allowedUses: [...source.selection.allowedUses]
                }
            });
            continue;
        }
        if (source.kind !== 'project_asset') continue;
        const absolutePath = buildSafeProjectAssetPath(projectPath, source.relativePath);
        if (!absolutePath) continue;
        references.set(part.reference.referenceId, {
            kind: 'project_asset',
            context: {
                schemaVersion: 'asset-selection-context/v0',
                path: absolutePath,
                name: part.reference.label,
                relativePath: source.relativePath,
                folderType: (source.folderType || 'unknown') as AssetSelectionContext['folderType'],
                imageType: (source.imageType || 'unknown') as AssetSelectionContext['imageType']
            }
        });
    }
    return references;
}

function buildFrozenComposerSubmission(input: {
    parts: readonly ChatComposerContentPart[];
    images: readonly DesignImageInput[];
    runtimeReferences: ReadonlyMap<string, ComposerRuntimeReference>;
}): FrozenComposerSubmission {
    const parts = input.parts.map((part): ChatComposerContentPart => {
        if (part.type === 'text') return { type: 'text', text: part.text };
        return {
            type: 'reference',
            reference: cloneChatComposerReference(part.reference)
        };
    });
    const imagesById = new Map(input.images.map((image) => [image.id, { ...image }]));
    const orderedImages: DesignImageInput[] = [];
    for (const part of parts) {
        if (part.type !== 'reference' || part.reference.source.kind !== 'uploaded_image') continue;
        const image = imagesById.get(part.reference.source.imageId);
        if (!image) continue;
        orderedImages.push(image);
        imagesById.delete(image.id);
    }
    const images = [...orderedImages, ...imagesById.values()];
    const orderedRuntimeReferences = parts
        .filter((part): part is Extract<ChatComposerContentPart, { type: 'reference' }> => part.type === 'reference')
        .map((part) => input.runtimeReferences.get(part.reference.referenceId))
        .filter((item): item is ComposerRuntimeReference => Boolean(item));

    const knowledgeReferences: KnowledgeSelectionReference[] = [];
    const seenKnowledgeBindings = new Set<string>();
    for (const runtimeReference of orderedRuntimeReferences) {
        if (runtimeReference.kind !== 'knowledge_selection') continue;
        if (seenKnowledgeBindings.has(runtimeReference.context.bindingRef)) continue;
        seenKnowledgeBindings.add(runtimeReference.context.bindingRef);
        knowledgeReferences.push({ ...runtimeReference.context });
    }

    const firstPrimaryReference = orderedRuntimeReferences.find((runtimeReference) => (
        runtimeReference.kind === 'project_asset'
        || runtimeReference.kind === 'eagle_asset'
        || runtimeReference.kind === 'eagle_asset_ref'
    ));
    if (firstPrimaryReference?.kind === 'project_asset') {
        return {
            parts,
            images,
            selectedAssetContext: { ...firstPrimaryReference.context },
            knowledgeReferences
        };
    }

    if (firstPrimaryReference?.kind === 'eagle_asset') {
        const eagleRefs = orderedRuntimeReferences
            .filter((item): item is Extract<ComposerRuntimeReference, { kind: 'eagle_asset' | 'eagle_asset_ref' }> => (
                item.kind === 'eagle_asset' || item.kind === 'eagle_asset_ref'
            ))
            .map((item) => item.kind === 'eagle_asset'
                ? cloneEagleAssetRef(item.context.assetRef)
                : cloneEagleAssetRef(item.context));
        if (eagleRefs.length === 1) {
            return {
                parts,
                images,
                selectedEagleLibraryAsset: cloneEagleLibrarySelectionContext(firstPrimaryReference.context),
                knowledgeReferences
            };
        }
        return {
            parts,
            images,
            selectedEagleAssetGroup: eagleRefs,
            knowledgeReferences
        };
    }

    if (firstPrimaryReference?.kind === 'eagle_asset_ref') {
        const eagleRefs = orderedRuntimeReferences
            .filter((item): item is Extract<ComposerRuntimeReference, { kind: 'eagle_asset' | 'eagle_asset_ref' }> => (
                item.kind === 'eagle_asset' || item.kind === 'eagle_asset_ref'
            ))
            .map((item) => item.kind === 'eagle_asset'
                ? cloneEagleAssetRef(item.context.assetRef)
                : cloneEagleAssetRef(item.context));
        return {
            parts,
            images,
            selectedEagleAssetGroup: eagleRefs,
            knowledgeReferences
        };
    }

    return {
        parts,
        images,
        knowledgeReferences
    };
}

function injectOrderedComposerSubmissionIntoMatchingUserMessage<
    T extends {
        role: string;
        content?: string | unknown[];
        contentBlocks?: AgentContentBlock[];
        contextMetadata?: {
            origin?: string;
            authority?: string;
            source?: string;
        };
    }
>(
    messages: T[],
    expectedUserInput: string,
    submission: FrozenComposerSubmission
): T[] | null {
    if (submission.parts.length === 0 || submission.images.length === 0) return null;
    const expectedText = String(expectedUserInput || '').trim();
    let currentUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (
            message.role === 'user'
            && message.contextMetadata?.origin === 'current_user_instruction'
            && message.contextMetadata?.authority === 'user'
        ) {
            currentUserIndex = index;
            break;
        }
    }
    if (currentUserIndex < 0) {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (
                message.role !== 'user'
                || message.contextMetadata?.authority === 'policy'
                || message.contextMetadata?.authority === 'data_only'
                || Array.isArray(message.content)
            ) {
                continue;
            }
            const candidateText = String(message.content || '').trim();
            if (
                candidateText === expectedText
                || (expectedText && candidateText.startsWith(`${expectedText}\n\n`))
            ) {
                currentUserIndex = index;
                break;
            }
        }
    }
    if (currentUserIndex < 0) return null;
    const currentMessage = messages[currentUserIndex];
    const currentContent = currentMessage?.content;
    if (Array.isArray(currentContent)) {
        return null;
    }
    const currentText = String(currentContent || '').trim();
    let trailingHarnessText = '';
    if (currentText === expectedText) {
        trailingHarnessText = '';
    } else if (expectedText && currentText.startsWith(`${expectedText}\n\n`)) {
        trailingHarnessText = currentText.slice(expectedText.length).trim();
    } else {
        return null;
    }

    const imagesById = new Map(submission.images.map((image) => [image.id, image]));
    const usedImageIds = new Set<string>();
    const allowedImageBlocks = (currentMessage?.contentBlocks || [])
        .filter((block) => block.type === 'image' && block.data)
        .map((block) => ({ ...block }));
    let referenceIndex = 0;
    const blocks: AgentContentBlock[] = [];
    function pushText(text: string): void {
        if (!text) return;
        const last = blocks[blocks.length - 1];
        if (last?.type === 'text') {
            last.text += text;
            return;
        }
        blocks.push({ type: 'text', text });
    }

    for (const part of submission.parts) {
        if (part.type === 'text') {
            pushText(part.text);
            continue;
        }
        referenceIndex += 1;
        const referenceMarker = buildChatComposerReferenceMarker(part.reference, referenceIndex);
        if (part.reference.source.kind !== 'uploaded_image') {
            pushText(referenceMarker);
            continue;
        }
        const image = imagesById.get(part.reference.source.imageId);
        if (!image) {
            pushText(`${referenceMarker}【图片引用不可用】`);
            continue;
        }
        const allowedImageIndex = allowedImageBlocks.findIndex((block) => (
            block.data === image.data
            && String(block.mediaType || 'image/jpeg') === image.mediaType
        ));
        if (allowedImageIndex < 0) {
            pushText(`${referenceMarker}【图片受本轮视觉预算限制，未附带像素】`);
            continue;
        }
        pushText(referenceMarker);
        blocks.push({
            type: 'image',
            data: image.data,
            mediaType: image.mediaType
        });
        allowedImageBlocks.splice(allowedImageIndex, 1);
        usedImageIds.add(image.id);
    }
    for (const image of submission.images) {
        if (usedImageIds.has(image.id)) continue;
        const allowedImageIndex = allowedImageBlocks.findIndex((block) => (
            block.data === image.data
            && String(block.mediaType || 'image/jpeg') === image.mediaType
        ));
        if (allowedImageIndex < 0) continue;
        referenceIndex += 1;
        pushText(`【引用${referenceIndex}：${image.name || '未命名图片'}；来源=图片附件】`);
        blocks.push({
            type: 'image',
            data: image.data,
            mediaType: image.mediaType
        });
        allowedImageBlocks.splice(allowedImageIndex, 1);
    }
    if (!submission.parts.some((part) => part.type === 'text' && part.text.trim())) {
        pushText('请结合这些图片处理我的当前请求。');
    }
    if (trailingHarnessText) {
        pushText(`\n\n${trailingHarnessText}`);
    }

    return messages.map((message, index) => (
        index === currentUserIndex
            ? { ...message, content: currentText, contentBlocks: blocks }
            : message
    ));
}

function buildEditableComposerPayload(message: ComposerEditableMessage): {
    parts: ChatComposerContentPart[];
    images: DesignImageInput[];
    exactOrderRecovered: boolean;
    removedInternalMarkers: boolean;
} {
    const images: DesignImageInput[] = [];
    for (const item of message.images || []) {
        const image = createDesignImageInput({
            id: item.id,
            data: item.data,
            type: item.type,
            name: item.name,
            source: 'unknown'
        });
        if (image) images.push(image);
    }
    if (message.image && images.length === 0) {
        const image = createDesignImageInput({
            data: message.image.data,
            type: message.image.type,
            name: '附件图片',
            source: 'unknown'
        });
        if (image) images.push(image);
    }

    const parts = Array.isArray(message.contentParts)
        ? normalizeChatComposerContentParts(message.contentParts).map((part) => (
            part.type === 'text'
                ? { type: 'text' as const, text: part.text }
                : { type: 'reference' as const, reference: cloneChatComposerReference(part.reference) }
        ))
        : [];
    const hasPersistedParts = parts.length > 0;
    let removedInternalMarkers = false;
    if (!hasPersistedParts) {
        const cleaned = stripChatComposerReferenceMarkers(message.content);
        const cleanedContent = cleaned.content;
        removedInternalMarkers = cleaned.removed;
        if (cleanedContent) {
            parts.push({ type: 'text', text: cleanedContent });
        }
    }
    const referencedImageIds = new Set(parts.flatMap((part) => (
        part.type === 'reference' && part.reference.source.kind === 'uploaded_image'
            ? [part.reference.source.imageId]
            : []
    )));
    let appendedOrphanImage = false;
    for (const image of images) {
        if (referencedImageIds.has(image.id)) continue;
        appendedOrphanImage = true;
        parts.push({
            type: 'reference',
            reference: {
                version: 'chat-composer-reference/v0',
                referenceId: createComposerReferenceId('image'),
                label: image.name || '附件图片',
                sourceLabel: '图片附件',
                mediaKind: 'image',
                source: {
                    kind: 'uploaded_image',
                    imageId: image.id,
                    mediaType: image.mediaType
                },
                addedAt: new Date().toISOString()
            }
        });
    }
    return {
        parts,
        images,
        exactOrderRecovered: hasPersistedParts && !appendedOrphanImage,
        removedInternalMarkers
    };
}

function buildPublicPlanPrivateOperationOwnerKey(
    sourceMessageId: unknown,
    requestId: unknown
): string {
    const sourceId = String(sourceMessageId || '').trim();
    const request = String(requestId || '').trim();
    return sourceId && request ? JSON.stringify([sourceId, request]) : '';
}

type PhotoshopMcpToolCallPayload = {
    error?: unknown;
    isError?: boolean;
    success?: boolean;
};

type LiveActivityState = VisibleAgentActivity;

function isDiagnosticsCommandEnabled(search = window.location.search || ''): boolean {
    try {
        const params = new URLSearchParams(search);
        return params.get('designechoDiagnostics') === '1'
            || (process.env.NODE_ENV === 'development'
                && params.get('designechoChatTestBridge') === '1');
    } catch {
        return false;
    }
}

function buildUserSlashHelpContent(): string {
    return `**可用命令**

- \`/optimize\` - 优化当前选中的文案
- \`/analyze\` - 分析当前文档的排版
- \`/status\` - 查看连接状态
- \`/clear\` - 清空对话历史
- \`/help\` - 显示此帮助信息

也可以直接输入设计需求，比如主图、SKU、详情页、图片理解或图层调整。`;
}

function isChatTestFakeModelRuntime(): boolean {
    try {
        return new URLSearchParams(window.location.search || '').get('designechoChatTestFakeModel') === '1';
    } catch {
        return false;
    }
}

function looksLikeChatTestFakeModelText(contentForOriginCheck?: unknown): boolean {
    const text = typeof contentForOriginCheck === 'string'
        ? contentForOriginCheck
        : String(contentForOriginCheck || '');
    if (!text.trim()) return false;
    return /测试\s*fixture\s*已收到请求|测试样本：|未调用真实模型或 Photoshop/u.test(text);
}

function normalizeAssistantReplyOriginForRuntime(
    origin: AssistantReplyOrigin | undefined,
    contentForOriginCheck?: unknown
): AssistantReplyOrigin | undefined {
    if (process.env.NODE_ENV !== 'development') return origin;
    const isFakeModelText = looksLikeChatTestFakeModelText(contentForOriginCheck);
    if (!origin) {
        return isFakeModelText
            ? testFixtureReplyOrigin('chat-test-fake-model:content-marker')
            : origin;
    }
    if (!isChatTestFakeModelRuntime() && !isFakeModelText) return origin;
    if (origin.origin !== 'model_authored' && origin.origin !== 'model_repaired') return origin;
    return testFixtureReplyOrigin(`chat-test-fake-model:${origin.source || 'unknown'}`);
}

function normalizeAgentUserVisibleNotice(input: unknown): AgentUserVisibleNotice | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const notice = input as Partial<AgentUserVisibleNotice>;
    const kind = notice.kind;
    if (kind !== 'status_notice' && kind !== 'tool_summary' && kind !== 'blocker_notice') {
        return undefined;
    }
    const content = String(notice.content || '').trim();
    if (!content) return undefined;
    const source = String(notice.source || '').trim();
    return {
        kind,
        content,
        ...(source ? { source } : {})
    };
}

function buildAgentUserVisibleNoticeOrigin(notice: AgentUserVisibleNotice): AssistantReplyOrigin {
    const source = notice.source || `agent-result:${notice.kind}`;
    if (notice.kind === 'blocker_notice') {
        return deterministicBlockerReplyOrigin(source);
    }
    if (notice.kind === 'tool_summary') {
        return toolSummaryReplyOrigin(source);
    }
    return uiStatusReplyOrigin(source);
}

function resolveAgentResultVisibleMessage(result: unknown): {
    content: string;
    assistantReplyOrigin?: AssistantReplyOrigin;
    userVisibleNotice?: AgentUserVisibleNotice;
} {
    const resultVisibleMessage = String((result as any)?.message || '');
    const resultUserVisibleNotice = normalizeAgentUserVisibleNotice(
        (result as any)?.userVisibleNotice || (result as any)?.data?.userVisibleNotice
    );
    const explicitOrigin =
        (result as any)?.assistantReplyOrigin
        || ((result as any)?.data?.assistantReplyOrigin as AssistantReplyOrigin | undefined);
    const noticeOrigin = resultUserVisibleNotice
        ? buildAgentUserVisibleNoticeOrigin(resultUserVisibleNotice)
        : undefined;
    const content = resultUserVisibleNotice?.content || resultVisibleMessage;

    return {
        content,
        assistantReplyOrigin: normalizeAssistantReplyOriginForRuntime(
            noticeOrigin || explicitOrigin,
            content
        ),
        ...(resultUserVisibleNotice ? { userVisibleNotice: resultUserVisibleNotice } : {})
    };
}

const STRUCTURED_AGENT_EXECUTION_STATUSES = new Set([
    'completed',
    'failed',
    'needs_review',
    'cancelled',
    'awaiting_confirmation'
]);

function normalizeAgentExecutionSummaryStatus(summary: Record<string, unknown>): AgentExecutionSummary {
    const rawStatus = String(summary.status || '').trim();
    if (!rawStatus || STRUCTURED_AGENT_EXECUTION_STATUSES.has(rawStatus)) {
        return summary as unknown as AgentExecutionSummary;
    }

    const existingWarnings = Array.isArray(summary.warnings)
        ? summary.warnings.map((warning) => String(warning || '').trim()).filter(Boolean)
        : [];
    const existingSummaryText = String(summary.summaryText || '').trim();
    return {
        ...summary,
        status: 'needs_review',
        summaryText: existingSummaryText || rawStatus,
        warnings: [
            ...existingWarnings,
            `执行状态字段不是结构化状态，已按需复核处理：${rawStatus.slice(0, 120)}`
        ]
    } as unknown as AgentExecutionSummary;
}

function readAgentExecutionSummaryFromResult(result: unknown): AgentExecutionSummary | undefined {
    const direct = (result as any)?.executionSummary;
    if (direct && typeof direct === 'object') {
        return normalizeAgentExecutionSummaryStatus(direct as Record<string, unknown>);
    }
    const nested = (result as any)?.data?.executionSummary;
    if (nested && typeof nested === 'object') {
        return normalizeAgentExecutionSummaryStatus(nested as Record<string, unknown>);
    }
    return undefined;
}

function buildRuntimePublicPlanLiveAdapterApproval(input: {
    enabled?: boolean;
    executeTool: typeof executeToolCall;
    projectPath?: string;
}) {
    if (input.enabled !== true) return {};

    const buildResult = createPublicPlanPhotoshopAdapter({
        approvedLiveAdapterRun: true,
        executionScope: 'disposable-document',
        executeTool: input.executeTool,
        projectPath: input.projectPath
    });
    if (buildResult.status !== 'ready_for_guarded_live_adapter' || !buildResult.adapter) {
        return {};
    }

    return {
        executionTarget: 'live-photoshop' as const,
        allowPhotoshopWrites: true,
        liveExecutionScope: 'disposable-document' as const,
        adapter: buildResult.adapter
    };
}

function extractUserVisibleErrorSource(error: unknown, fallback = '未知错误'): string {
    if (error instanceof Error) return error.message || fallback;
    if (typeof error === 'string') return error || fallback;
    if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as { message?: unknown }).message;
        return typeof message === 'string' && message.trim() ? message : fallback;
    }
    return fallback;
}

function formatUserVisibleFailureContent(title: string, error: unknown, fallback = '未知错误'): string {
    return formatAssistantFailureContent({
        prefix: '❌ ',
        message: title,
        error: extractUserVisibleErrorSource(error, fallback)
    });
}

function formatUserVisibleFailureLine(label: string, error: unknown, fallback = '失败'): string {
    const detail = sanitizeUserVisibleDiagnosticText(extractUserVisibleErrorSource(error, fallback)) || fallback;
    return `❌ ${label}: ${detail}`;
}

function sanitizeTestSnapshotPreview(value: unknown, fallback = ''): string {
    const text = String(value || '').trim();
    if (!text) return fallback;
    return sanitizeUserVisibleAssistantBodyText(text)
        || sanitizeUserVisibleDiagnosticText(text)
        || fallback;
}

function sanitizeTestSnapshotToken(value: unknown, fallback = ''): string {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    return text || fallback;
}

function formatTestSnapshotThinkingStep(step: any): string {
    const toolDisplayName = step?.toolName
        ? getToolDisplayInfo(String(step.toolName)).name
        : '';
    return [
        sanitizeTestSnapshotToken(step?.type),
        toolDisplayName,
        sanitizeTestSnapshotPreview(step?.content),
        sanitizeTestSnapshotToken(step?.status)
    ].filter(Boolean).join(': ');
}

function readTestSnapshotRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function summarizeChatTestTaskPlan(value: unknown): {
    identity: {
        sessionId: string;
        runId: string;
        generation: number;
        revision: number;
        revisionHash: string;
        projectId: string;
    };
    steps: Array<{
        id: string;
        kind: string;
        status: string;
    }>;
} | undefined {
    const presentation = readTestSnapshotRecord(value);
    const identity = readTestSnapshotRecord(presentation.identity);
    const sessionId = sanitizeTestSnapshotToken(identity.sessionId);
    const runId = sanitizeTestSnapshotToken(identity.runId);
    if (!sessionId || !runId) return undefined;

    const steps = Array.isArray(presentation.steps)
        ? presentation.steps
            .map((item) => {
                const step = readTestSnapshotRecord(item);
                return {
                    id: sanitizeTestSnapshotToken(step.id),
                    kind: sanitizeTestSnapshotToken(step.kind),
                    status: sanitizeTestSnapshotToken(step.status)
                };
            })
            .filter((step) => step.id)
            .slice(0, 24)
        : [];

    return {
        identity: {
            sessionId,
            runId,
            generation: Number(identity.generation) || 0,
            revision: Number(identity.revision) || 0,
            revisionHash: sanitizeTestSnapshotToken(identity.revisionHash),
            projectId: sanitizeTestSnapshotToken(identity.projectId)
        },
        steps
    };
}

function summarizeChatTestToolResults(value: unknown): Array<{
    toolName: string;
    success: boolean;
    code: string;
    photoshopOperationResult?: {
        operationId: string;
        toolName: string;
        status: string;
        applicationStatus: string;
        transactionState: string;
        effect: string;
        before?: { documentId: number; historyStateId: number };
        after?: { documentId: number; historyStateId: number };
    };
}> {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            const step = readTestSnapshotRecord(item);
            const toolName = sanitizeTestSnapshotToken(step.toolName);
            const result = readTestSnapshotRecord(step.toolResult);
            if (!toolName || Object.keys(result).length === 0) return undefined;
            const operationResult = readPhotoshopOperationResult(result);
            return {
                toolName,
                success: result.success !== false,
                code: sanitizeTestSnapshotToken(result.code),
                ...(operationResult ? {
                    photoshopOperationResult: {
                        operationId: sanitizeTestSnapshotToken(operationResult.operationId),
                        toolName: sanitizeTestSnapshotToken(operationResult.toolName),
                        status: operationResult.status,
                        applicationStatus: operationResult.applicationStatus,
                        transactionState: operationResult.transactionState,
                        effect: operationResult.effect,
                        ...(operationResult.before ? { before: operationResult.before } : {}),
                        ...(operationResult.after ? { after: operationResult.after } : {})
                    }
                } : {})
            };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 24);
}

function summarizePublicPlanControlledRunOperationResults(run: unknown): Array<{
    toolName: string;
    success: boolean;
    error: string;
    dataErrors: string[];
}> {
    const runRecord = readTestSnapshotRecord(run);
    const operationResults = Array.isArray(runRecord.operationResults)
        ? runRecord.operationResults
        : [];
    return operationResults
        .map((item) => {
            const result = readTestSnapshotRecord(item);
            const data = readTestSnapshotRecord(result.data);
            const dataErrors = Array.isArray(data.errors)
                ? data.errors
                    .map((errorItem) => {
                        const errorRecord = readTestSnapshotRecord(errorItem);
                        const block = sanitizeTestSnapshotToken(errorRecord.block);
                        const role = sanitizeTestSnapshotToken(errorRecord.role);
                        const error = sanitizeTestSnapshotPreview(errorRecord.error).slice(0, 300);
                        return [block, role, error].filter(Boolean).join(': ');
                    })
                    .filter(Boolean)
                    .slice(0, 8)
                : [];
            return {
                toolName: sanitizeTestSnapshotToken(result.toolName),
                success: result.success === true,
                error: sanitizeTestSnapshotPreview(result.error).slice(0, 500),
                dataErrors
            };
        })
        .filter((item) => item.toolName)
        .slice(0, 12);
}

function collectChatSnapshotVisibleStrings(value: unknown, output: string[] = [], key = ''): string[] {
    if (value === null || value === undefined) return output;
    const visiblePrimitiveKeys = new Set([
        'title',
        'content',
        'label',
        'value',
        'text',
        'description',
        'message',
        'summary',
        'actionHint'
    ]);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        if (key && !visiblePrimitiveKeys.has(key)) return output;
        const preview = sanitizeTestSnapshotPreview(value);
        if (preview) output.push(preview);
        return output;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => collectChatSnapshotVisibleStrings(item, output, key));
        return output;
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (record.collapsible === true && record.defaultCollapsed === true) {
            collectChatSnapshotVisibleStrings(record.title, output, 'title');
            return output;
        }
        Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
            if ([
                'id',
                'type',
                'variant',
                'icon',
                'status',
                'timestamp',
                'style',
                'metadata',
                'collapsible',
                'defaultCollapsed',
                'action',
                'params',
                'payload',
                'result',
                'toolResult',
                'progress',
                'current',
                'total'
            ].includes(key)) return;
            collectChatSnapshotVisibleStrings(child, output, key);
        });
    }
    return output;
}

function resolveChatSnapshotAgentUserVisibleState(message: unknown) {
    const state = (message as any)?.agentTaskPlan?.userVisibleState;
    if (!state || state.version !== 'agent-user-visible-state/v0') return undefined;
    const category = String(state.category || '').trim();
    const toolUse = String(state.toolUse || '').trim();
    const title = sanitizeTestSnapshotPreview(state.title);
    const categoryAllowed = ['conversation', 'clarification', 'read_only', 'planning', 'tool_execution', 'controlled_execution', 'blocked'].includes(category);
    const toolUseAllowed = ['no_tools', 'read_only', 'direct_tools', 'controlled_write_after_gate', 'blocked'].includes(toolUse);
    if (!categoryAllowed || !toolUseAllowed) return undefined;
    if (!title || !category || !toolUse) return undefined;
    return {
        category,
        title,
        toolUse,
        summaryPreview: sanitizeTestSnapshotPreview(state.summary).slice(0, 500),
        nextStepPreview: sanitizeTestSnapshotPreview(state.nextStep).slice(0, 500),
        canStartTools: state.canStartTools === true,
        userActionRequired: state.userActionRequired === true
    };
}

function shouldDropCompletedMechanicalThinking(
    step: ThinkingStep,
    lifecycle?: AgentRequestLifecycleRecord
): boolean {
    if (step.type !== 'thinking') return false;
    const content = String(step.content || '').trim();
    const observation = classifyAgentObservationChannel({
        source: 'model_visible_reasoning',
        content
    });
    const isBlockedLocalPlaceholder = observation.channel === 'blocked'
        && observation.userVisible === false
        && observation.canPersistToThinkingSteps === false;
    const isMechanicalProcessCopy = isBlockedLocalPlaceholder || /^(工具完成|执行\s|已开始执行|准备调用)/.test(content);
    if (!isMechanicalProcessCopy) return false;
    const skillId = lifecycle?.decision?.skillId || lifecycle?.execution?.expectedExecutor;
    return lifecycle?.decision?.source === 'deterministic_route'
        && lifecycle?.decision?.route === 'skill_execution'
        && lifecycle?.execution?.kind === 'deterministic_skill'
        && isSimpleDeterministicShortPathSkill(skillId);
}

function shouldPersistVisibleProcessStep(
    step: ThinkingStep,
    lifecycle?: AgentRequestLifecycleRecord
): boolean {
    if (lifecycle?.decision?.route === 'direct_response' || lifecycle?.execution?.kind === 'none') {
        return false;
    }
    return isVisiblePonderingStep(step) && !shouldDropCompletedMechanicalThinking(step, lifecycle);
}

function normalizePersistedVisibleProcessSteps(steps?: ThinkingStep[]): ThinkingStep[] | undefined {
    if (!Array.isArray(steps) || steps.length === 0) return undefined;
    const normalizedSteps = steps.flatMap((step) => {
        const normalizedContent = step.type === 'thinking'
            ? finalizeUserVisibleThinkingText(step.content)
            : step.content;
        if (step.type === 'thinking' && !normalizedContent) {
            return [];
        }
        return {
            ...step,
            content: normalizedContent,
            status: step.status === 'running' || step.status === 'pending'
                ? 'success'
                : step.status
        };
    });
    return normalizedSteps.length > 0 ? normalizedSteps : undefined;
}

function normalizeStoppedVisibleProcessSteps(steps?: ThinkingStep[]): ThinkingStep[] | undefined {
    if (!Array.isArray(steps) || steps.length === 0) return undefined;
    // 停止瞬间还在跑的步骤如实标为「未完成」保留下来，不能整条丢弃：
    // 用户停在哪一步，历史里就要看得到那一步（丢弃 = 停止后过程凭空少一段）。
    const settledSteps = steps.map((step) => (
        step.status === 'running' || step.status === 'pending'
            ? { ...step, status: 'error' as const }
            : step
    ));
    return normalizePersistedVisibleProcessSteps(settledSteps);
}

function shouldIncludeMessageInAgentConversationHistory(message: {
    content?: unknown;
    agentResponseInterruption?: unknown;
    assistantReplyOrigin?: unknown;
}): boolean {
    if (!resolveAgentResponseInterruption({
        interruption: message.agentResponseInterruption,
        assistantReplyOrigin: message.assistantReplyOrigin,
        content: message.content
    })) {
        return true;
    }
    return typeof message.content === 'string'
        && message.content.trim().length > 0
        && !isAgentResponseInterruptionSentinelContent(message.content);
}

function normalizeComparableVisibleText(value: unknown): string {
    return sanitizeUserVisibleDiagnosticText(String(value || ''))
        .replace(/^[\s⚠️❌✅!！i]+/, '')
        .replace(/^(?:错误|Error)\s*[:：]\s*/i, '')
        .replace(/[。！？!?,，、；;：:\s]/g, '')
        .trim();
}

function uniqueModelIds(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const modelId = String(value || '').trim();
        if (!modelId || seen.has(modelId)) continue;
        seen.add(modelId);
        result.push(modelId);
    }
    return result;
}

function resolveComposerThinkingModelIds(preferences?: Partial<ModelPreferences> | null): string[] {
    const tasks: ConversationTaskType[] = ['general', 'logic', 'copywriting', 'visual'];
    const ids = tasks.flatMap((taskType) => [
        ...getModelPriorityForConversationTask(preferences, taskType, { includeFallback: true }),
        ...getModelRecoveryPriorityForConversationTask(preferences, taskType)
    ]);

    return uniqueModelIds(ids).filter(isModelThinkingUserControllable);
}

/** 输入栏模型选择器上的运行模式徽标文案（与设置页「运行模式」同名）。 */
const COMPOSER_RUN_MODE_LABELS: Record<'local' | 'cloud', string> = {
    local: '本地模式',
    cloud: '云端模式'
};

function compactModelFailureText(value: unknown): string {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function looksLikeProviderFailureText(value: unknown): boolean {
    const text = compactModelFailureText(value);
    if (!text || text.length > 1200) return false;
    // 这个判据只能检查无 success/ok 字段、但带结构化 code/status 的兼容失败包。
    // 模型正常返回的正文不得进入本函数。即便在结构化失败包中，也只认带上下文的失败信号，
    // 绝不认裸状态码：原先正则里的 |401|403| 会让回复中任何一个独立的 401/403 数字
    //（色号、尺寸、JSON 数值……）把一次成功的调用判成认证失败——真机 2026-08-01 即如此：
    // 主进程毫无错误日志、API Key 测试通过、重启无效，因为那次调用根本没失败。
    // 真实 provider 报错一律带 http/status 语义前缀，已由前面的分支覆盖；
    // 万一漏判也只是降级成 unknown 分类，代价远小于把一条好回复整个丢掉。
    return /\b(?:provider\s*http|http\s*(?:status\s*)?(?:401|403|429|500|502|503)|status(?:\s*code)?\s*(?:401|403|429|500|502|503)|unauthorized|forbidden|invalid\s+api\s+key|api[_-]?key[_-]?invalid|authentication\s+(?:error|failed|failure)|permission_denied|quota_exceeded|rate\s*limit)\b/i.test(text)
        || /(?:认证|鉴权|授权|权限|密钥|额度|限流|接口调用)失败|API\s*Key\s*(?:无效|错误|未配置|不可用)|(?:无效|错误|未配置|不可用)的\s*API\s*Key|当前已选模型认证失败/i.test(text);
}

function extractModelCallFailureMessage(response: unknown): string | null {
    if (!response) return 'empty response';
    if (typeof response === 'string') {
        // 纯字符串是模型正文。Provider 失败应由请求边界抛错或显式 failure envelope 表达，
        // 不能因为模型正文讨论了 API Key、403、限流等主题就整条作废。
        return null;
    }
    if (typeof response !== 'object') return null;

    const payload = response as {
        success?: unknown;
        ok?: unknown;
        error?: unknown;
        message?: unknown;
        text?: unknown;
        reason?: unknown;
        code?: unknown;
        status?: unknown;
    };
    const explicitFailure = payload.success === false || payload.ok === false || Boolean(payload.error);
    const explicitFailureText = compactModelFailureText(
        payload.error || payload.message || payload.reason || payload.text
    );
    if (explicitFailure) {
        return explicitFailureText || 'model call failed';
    }

    if (payload.success === true || payload.ok === true) return null;

    const codeOrStatus = compactModelFailureText(payload.code || payload.status);
    const structuredFailure = [
        codeOrStatus ? `status ${codeOrStatus}` : '',
        compactModelFailureText(payload.message || payload.reason)
    ].filter(Boolean).join(': ');
    if (codeOrStatus && looksLikeProviderFailureText(structuredFailure)) {
        return structuredFailure;
    }

    return null;
}

function filterRedundantFailureProcessSteps(
    steps: ThinkingStep[],
    failureContent: string
): ThinkingStep[] {
    const normalizedFailure = normalizeComparableVisibleText(failureContent);
    if (!normalizedFailure) return steps;

    return steps.filter((step) => {
        const normalizedStep = normalizeComparableVisibleText(step.content);
        if (normalizedStep.length < 8) return true;
        return !normalizedFailure.includes(normalizedStep);
    });
}

/**
 * 把「当前活动」并进步骤流末尾，让运行中的状态在有历史步骤之后依然可见。
 *
 * 旧版渲染处是 if/else：只要开场观察产生了可见步骤，LiveActivityIndicator 就再也
 * 不渲染。而模型单次调用真机实测能跑 58 秒（run-20260814072841256：modelDurationMs
 * 58383、toolDurationMs 仅 1263），这段时间面板停在最后一条「已查看当前画面」、
 * 标题是静态的「设计过程」、状态点也不呼吸——用户只能判断它卡死了，实际上模型正在
 * 输出。合并之后运行状态由末尾这条 running 步骤表达，标题文案与呼吸点的既有判据
 * （hasActiveThinkingStep）自动生效，不需要再引入第二套状态口径。
 */
/** 模型回合等待超过这个秒数才显示计秒（短回合不制造噪音）。 */
const LIVE_ACTIVITY_ELAPSED_VISIBLE_AFTER_SECONDS = 6;

function formatLiveActivityContent(activity: LiveActivityState, nowMs: number): string {
    const detail = String(activity.detail || activity.agentLabel || '').trim();
    if (!detail) return '';
    if (typeof activity.startedAt !== 'number') return detail;
    const elapsedSeconds = Math.floor((nowMs - activity.startedAt) / 1000);
    if (elapsedSeconds < LIVE_ACTIVITY_ELAPSED_VISIBLE_AFTER_SECONDS) return detail;
    // 真机模型回合常跑 40–110 秒（带图更久）：让等待可感知，用户不会以为卡死。
    return `${detail}（已 ${elapsedSeconds} 秒）`;
}

function appendLiveActivityStep(
    steps: ThinkingStep[],
    activity: LiveActivityState | null,
    nowMs: number = Date.now()
): ThinkingStep[] {
    if (!activity) return steps;
    const content = formatLiveActivityContent(activity, nowMs);
    if (!content) return steps;
    return [
        ...steps,
        {
            id: 'live-activity-tail',
            type: 'status',
            content,
            status: 'running',
            timestamp: nowMs
        }
    ];
}

const LiveActivityIndicator: React.FC<{ activity: LiveActivityState; nowMs?: number }> = ({ activity, nowMs }) => (
    <div
        className="thinking-simple live-thinking live-activity-placeholder"
        aria-live="polite"
        data-testid="live-agent-activity"
    >
        <div className="pondering-header">
            <span className="pondering-dot"></span>
            <span className="pondering-title">{formatLiveActivityContent(activity, nowMs ?? Date.now()) || activity.agentLabel}</span>
        </div>
    </div>
);

// 模型配置导入已移至 useChatActions hook

// 日志工具函数 - 同时输出到控制台和日志文件
const agentLog = (level: 'info' | 'warn' | 'error', message: string, data?: any) => {
    const prefix = {
        info: '[Agent] ℹ️',
        warn: '[Agent] ⚠️',
        error: '[Agent] ❌'
    }[level];
    
    // 输出到控制台
    if (data) {
        console.log(`${prefix} ${message}`, data);
    } else {
        console.log(`${prefix} ${message}`);
    }
    
    // 写入到日志文件
    if (window.designEcho?.writeLog) {
        window.designEcho.writeLog(level, message, data);
    }
};

function summarizeAgentToolResultForLog(result: any): Record<string, unknown> {
    const record = result && typeof result === 'object' && !Array.isArray(result)
        ? result as Record<string, any>
        : {};
    const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
        ? record.data as Record<string, any>
        : {};
    const observation = data.agentReActObservation
        && typeof data.agentReActObservation === 'object'
        && !Array.isArray(data.agentReActObservation)
        ? data.agentReActObservation as Record<string, any>
        : {};
    const compactText = (value: unknown): string | undefined => {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) return undefined;
        return text.length > 300 ? `${text.slice(0, 299)}…` : text;
    };
    return {
        success: record.success !== false,
        ...(record.nonFatal === true ? { nonFatal: true } : {}),
        ...(record.cancelled === true ? { cancelled: true } : {}),
        ...(record.code ? { code: String(record.code) } : {}),
        ...(record.status ? { status: String(record.status) } : {}),
        ...(record.skillOutcome?.status ? { skillStatus: String(record.skillOutcome.status) } : {}),
        ...(compactText(record.message) ? { message: compactText(record.message) } : {}),
        ...(compactText(record.error) ? { error: compactText(record.error) } : {}),
        ...(compactText(observation.summary) ? { workSummary: compactText(observation.summary) } : {}),
        fields: Object.keys(record).slice(0, 20)
    };
}

// V1-7b 幂等守卫：破坏性动作确认卡按定义 id 防重复确定性重放（对非幂等的
// interactWithBrowserPage click 尤其致命：重复=重复下单/支付）。人工复核卡的定义 id 是稳定状态
// 指纹，同一批未确认内容可在后续 Agent 消息中合法再次出现，因此必须按“来源消息/块 + card.id”
// 守护一次渲染实例；同卡快速双击被拦，新消息里的新卡仍可提交。
const submittedDestructiveActionCardIds = new Set<string>();
const submittedSkillInteractiveReviewInstanceKeys = new Set<string>();
const submittedDesignProjectFactReviewCardInstanceKeys = new Set<string>();
const submittedDesignProjectRuleReviewCardInstanceKeys = new Set<string>();
const persistedInteractiveReviewSubmissions = new Map<string, {
    submission: InteractiveCardSubmission;
    reviewLabel: string;
}>();
const internalResumeLaunchStates = new Map<string, {
    request: AgentInternalResumeRequest;
    status: 'in_flight' | 'launched' | 'retryable';
}>();

interface ChatPanelProps {
    externalDraft?: string;
    externalDraftRevision?: number;
    activeWorkspacePage?: string;
    workflowSelectionContext?: WorkflowSelectionContext | null;
    selectedAssetContext?: AssetSelectionContext | null;
    /** 仅由拖拽、右键菜单或显式按钮产生；Eagle 页普通浏览选择不得进入这里。 */
    eagleComposerInsertRequest?: EagleComposerInsertRequest | null;
    knowledgeReferences?: KnowledgeSelectionReference[];
    onClearSelectedAssetContext?: () => void;
    onConsumeEagleComposerInsertRequest?: (revision: number) => void;
    onRemoveKnowledgeReference?: (bindingRef: string) => void;
    onRequestOpenWorkspacePage?: (page: 'assets' | 'eagle' | 'knowledge') => void;
}

/**
 * 工作流上下文只保留「文档身份」，不再携带选中节点。
 *
 * 画布上点一个节点曾经会自动变成本次对话的主选择：输入栏冒出「节点 · XXX」胶囊，
 * 同时进入提交快照参与 multiple_primary_selections 互斥。用户明确取消了这个关联——
 * 在画布上选中只是画布内的操作（高亮/复制/删除），不代表"我要跟 Agent 聊这个节点"。
 *
 * 契约里 OperatingWorkflowContext.selectedNode 仍是可选字段（v5 快照与提示词都能处理缺省），
 * 这里只是不再产出它；要恢复关联需要重新给用户一个显式入口，而不是靠点击顺手绑定。
 */
function toOperatingWorkflowContext(
    context?: WorkflowSelectionContext | null
): OperatingWorkflowContext | undefined {
    if (!context) return undefined;
    return {
        documentId: context.workflowDocument.id,
        lifecycle: context.workflowDocument.state,
        revision: context.graph.revision
    };
}

function buildOperatingWorkspaceRevision(input: {
    projectId?: string;
    projectPath?: string;
    activePage?: string;
    workflowRevision?: string;
    selectedAssetPath?: string;
    selectedLibraryAssetId?: string;
    knowledgeBindingRefs?: string[];
}): string {
    return [
        `project:${input.projectId || input.projectPath || 'none'}`,
        `page:${input.activePage || 'unknown'}`,
        `workflow:${input.workflowRevision || 'none'}`,
        `asset:${input.selectedAssetPath || 'none'}`,
        `libraryAsset:${input.selectedLibraryAssetId || 'none'}`,
        `knowledge:${(input.knowledgeBindingRefs || []).join(',') || 'none'}`
    ].join('|');
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
    externalDraft,
    externalDraftRevision,
    activeWorkspacePage,
    workflowSelectionContext,
    selectedAssetContext,
    eagleComposerInsertRequest,
    knowledgeReferences = [],
    onClearSelectedAssetContext,
    onConsumeEagleComposerInsertRequest,
    onRemoveKnowledgeReference,
    onRequestOpenWorkspacePage
}) => {
    const { 
        messages, addMessage, addMessageToConversation, updateMessage, updateMessageInConversation,
        conversations, currentConversationId, createConversation, deleteConversation, switchConversation,
        updateConversationTitle, reorderConversations,
        isLoading, setLoading, isPluginConnected, replaceUserMessageAndTruncate,
        setAbortController, stopGeneration,
        modelPreferences,  // 获取用户模型偏好
        setModelPreferences,
        dynamicModels,  // 动态拉取模型注册表（Agent 模型选择器候选的补全层，与设置页同源）
        designKnowledgeSettings,
        designDimensionSpec,
        agentDecisionMode,
        setAgentDecisionMode
    } = useAppStore();

    // 使用 Hook 获取业务逻辑（模型优先级、Agent 处理等）
    const { 
        // 智能模型协作
        detectTaskType
    } = useChatActions({ isPluginConnected });
    const [input, setInput] = useState('');
    // 输入框 Skill 选择器（codex 式）：null=自动（模型自主）；选定后随发送进 AgentContext 作权威路线提示。
    const [selectedComposerSkillId, setSelectedComposerSkillId] = useState<string | null>(null);
    const [showUpload, setShowUpload] = useState(false);  // 参考图上传面板
    const [showAttachMenu, setShowAttachMenu] = useState(false);  // 附件菜单（+按钮）
    const [referenceImage, setReferenceImage] = useState<string | null>(null);
    const [composerImages, setComposerImages] = useState<DesignImageInput[]>([]);
    const [composerSnapshot, setComposerSnapshot] = useState<InlineMultimodalComposerSnapshot>({
        parts: [],
        text: '',
        referenceCount: 0
    });
    const [composerDragKind, setComposerDragKind] = useState<'files' | 'eagle' | null>(null);
    
    // 已发送消息的编辑草稿与底部新消息 Composer 完全隔离，避免编辑时覆盖未发送内容。
    const [messageEditSession, setMessageEditSession] = useState<MessageEditSession | null>(null);
    const [messageEditSnapshot, setMessageEditSnapshot] = useState<InlineMultimodalComposerSnapshot>({
        parts: [],
        text: '',
        referenceCount: 0
    });
    const [messageEditError, setMessageEditError] = useState('');
    const [messageEditSubmitting, setMessageEditSubmitting] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    // 贴底跟随判据：用户本就贴着底部才自动跟随新内容；上滚回看时绝不打断。
    // ref 供滚动效应同步读取，state 只驱动「回到最新」按钮的显隐。
    const stickToBottomRef = useRef(true);
    const lastMessagesScrollTopRef = useRef(0);
    const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
    const attachMenuContainerRef = useRef<HTMLDivElement>(null);
    const firstAttachMenuItemRef = useRef<HTMLButtonElement>(null);
    const composerRef = useRef<InlineMultimodalComposerHandle>(null);
    const messageEditComposerRef = useRef<InlineMultimodalComposerHandle>(null);
    const inputAreaRef = useRef<HTMLDivElement>(null);
    const composerRuntimeReferencesRef = useRef(new Map<string, ComposerRuntimeReference>());
    const messageEditRuntimeReferencesRef = useRef(new Map<string, ComposerRuntimeReference>());
    const composerImagesRef = useRef<DesignImageInput[]>([]);
    const messageEditImagesRef = useRef<DesignImageInput[]>([]);
    const pendingComposerImageBytesRef = useRef(new Map<string, number>());
    const [composerPendingImageCount, setComposerPendingImageCount] = useState(0);
    const capturedProjectAssetKeyRef = useRef<string | null>(null);
    const capturedKnowledgeBindingRefsRef = useRef(new Set<string>());
    const handleSendRef = useRef<((override?: ChatSendOverride) => Promise<void>) | null>(null);
    // 本轮提交的身份令牌（null = 没有在途提交）。
    //
    // 原先这里是裸 boolean，只在 handleSend 最外层 finally 复位——也就是必须等整条异步链
    // 真正返回。但用户点「停止」时 stopGeneration 只把 store 的 isLoading 置 false，于是
    // 底部按钮立刻切回「发送」、界面也写上了「你已停止此响应」，而这个标志还挂着 true，
    // 发送守卫照旧报「当前已有设计任务正在执行」。同一时刻界面说停了、守卫说在跑，用户
    // 只能反复点发送。改成令牌后停止可以立即释放它，而旧链收尾时按令牌比对，不会误清
    // 用户停止后新发起的那一轮（与 activeAgentRunIdRef 的 runId 守卫同一套思路）。
    const chatSubmissionInFlightRef = useRef<string | null>(null);
    const activeDebugBridgeRequestIdRef = useRef<string | null>(null);
    const cancelledDebugBridgeRequestIdsRef = useRef<Set<string>>(new Set());
    const publicPlanPrivateOperationRequestsRef = useRef<Record<string, AgentTaskPublicPlanControlledOperationRequest[]>>({});
    const activeAgentRunIdRef = useRef<string | null>(null);
    const cancelledAgentRunIdsRef = useRef<Set<string>>(new Set());
    const activeAgentRunUiRef = useRef<{
        runId: string;
        conversationId: string | null;
        streamedAssistantMessageId: string | null;
        visibleSteps: ThinkingStep[];
        stopMessageShown: boolean;
    } | null>(null);

    const insertComposerReference = useCallback((
        reference: ChatComposerReference,
        runtimeReference: ComposerRuntimeReference,
        previewUrl?: string
    ): void => {
        composerRuntimeReferencesRef.current.set(reference.referenceId, runtimeReference);
        composerRef.current?.insertReference(reference, previewUrl);
    }, []);

    const insertEagleAssetRefsIntoComposer = useCallback((assetRefs: readonly EagleAssetRef[]): void => {
        const normalizedRefs = normalizeEagleComposerAssetRefs(assetRefs);
        const existingKeys = new Set(
            (composerRef.current?.getSnapshot().parts || [])
                .filter((part): part is Extract<ChatComposerContentPart, { type: 'reference' }> => (
                    part.type === 'reference' && part.reference.source.kind === 'eagle_asset'
                ))
                .map((part) => {
                    const assetRef = part.reference.source.kind === 'eagle_asset'
                        ? part.reference.source.assetRef
                        : undefined;
                    return assetRef ? `${assetRef.libraryId}:${assetRef.itemId}` : '';
                })
                .filter(Boolean)
        );
        for (const assetRef of normalizedRefs) {
            const assetKey = `${assetRef.libraryId}:${assetRef.itemId}`;
            if (existingKeys.has(assetKey)) continue;
            existingKeys.add(assetKey);
            const reference: ChatComposerReference = {
                version: 'chat-composer-reference/v0',
                referenceId: createComposerReferenceId('eagle'),
                label: assetRef.name,
                sourceLabel: assetRef.libraryName || 'Eagle',
                mediaKind: resolveEagleComposerMediaKind(assetRef.fileKind),
                source: {
                    kind: 'eagle_asset',
                    assetRef: cloneEagleAssetRef(assetRef)
                },
                addedAt: new Date().toISOString()
            };
            insertComposerReference(reference, {
                kind: 'eagle_asset_ref',
                context: cloneEagleAssetRef(assetRef)
            });
            void getEagleLibraryPreview({
                purpose: 'composer_ui',
                libraryId: assetRef.libraryId,
                itemId: assetRef.itemId,
                maxSize: 96
            }).then((result) => {
                if (!result.success || !result.dataUrl) return;
                composerRef.current?.updateReferencePreview(reference.referenceId, result.dataUrl);
            });
        }
    }, [insertComposerReference]);

    const addComposerImage = useCallback((params: {
        data: string;
        type?: string;
        name?: string;
        source: 'chat-paste' | 'chat-upload';
        originalBytes?: number;
    }): void => {
        const currentImages = composerImagesRef.current;
        const reservedImageCount = currentImages.length + pendingComposerImageBytesRef.current.size;
        if (reservedImageCount >= MAX_COMPOSER_IMAGES) {
            addLocalBlockerMessage(
                `一次消息最多附加 ${MAX_COMPOSER_IMAGES} 张图片，请移除部分图片后再添加。`,
                'composer:image-limit'
            );
            return;
        }
        const imageBytes = params.originalBytes ?? estimateBase64PayloadBytes(params.data);
        if (imageBytes > MAX_COMPOSER_IMAGE_FILE_BYTES) {
            addLocalBlockerMessage(
                `图片“${params.name || '未命名图片'}”超过 8 MB，请压缩后再添加。`,
                'composer:image-file-too-large'
            );
            return;
        }
        const committedBytes = currentImages.reduce((total, image) => (
            total + estimateBase64PayloadBytes(image.data)
        ), 0);
        const pendingBytes = Array.from(pendingComposerImageBytesRef.current.values())
            .reduce((total, value) => total + value, 0);
        if (committedBytes + pendingBytes + imageBytes > MAX_COMPOSER_IMAGE_TOTAL_BYTES) {
            addLocalBlockerMessage(
                '本条消息的图片总大小不能超过 20 MB，请移除部分图片后再添加。',
                'composer:image-total-too-large'
            );
            return;
        }
        const image = createDesignImageInput({
            data: params.data,
            type: params.type,
            name: params.name,
            source: params.source
        });
        if (!image) return;
        const nextImages = [...currentImages, image];
        composerImagesRef.current = nextImages;
        setComposerImages(nextImages);
        const reference: ChatComposerReference = {
            version: 'chat-composer-reference/v0',
            referenceId: createComposerReferenceId('image'),
            label: params.name || `图片 ${currentImages.length + 1}`,
            sourceLabel: params.source === 'chat-paste' ? '剪贴板' : '本地图片',
            mediaKind: 'image',
            source: {
                kind: 'uploaded_image',
                imageId: image.id,
                mediaType: image.mediaType
            },
            addedAt: new Date().toISOString()
        };
        insertComposerReference(
            reference,
            { kind: 'uploaded_image', imageId: image.id },
            `data:${image.mediaType};base64,${image.data}`
        );
    }, [insertComposerReference]);

    const resetComposerForConversationChange = useCallback((): void => {
        setInput('');
        setShowUpload(false);
        setShowAttachMenu(false);
        setReferenceImage(null);
        composerImagesRef.current = [];
        setComposerImages([]);
        pendingComposerImageBytesRef.current.clear();
        setComposerPendingImageCount(0);
        composerRuntimeReferencesRef.current.clear();
        composerRef.current?.clear();
        messageEditRuntimeReferencesRef.current.clear();
        messageEditImagesRef.current = [];
        setMessageEditSession(null);
        setMessageEditSnapshot({ parts: [], text: '', referenceCount: 0 });
        setMessageEditError('');
        setMessageEditSubmitting(false);
    }, []);

    const confirmActiveConversationChange = useCallback((actionLabel: string): boolean => {
        const hasUnsentComposerContent = Boolean(
            composerSnapshot.parts.length > 0
            || composerImages.length > 0
            || referenceImage
        );
        const hasInlineMessageEdit = Boolean(messageEditSession);
        if (!hasUnsentComposerContent && !hasInlineMessageEdit) return true;

        let impact = '会清除当前未发送的输入和附件';
        if (hasInlineMessageEdit && hasUnsentComposerContent) {
            impact = '会取消当前消息编辑，并清除底部未发送的输入和附件';
        } else if (hasInlineMessageEdit) {
            impact = '会取消当前消息编辑';
        }
        return window.confirm(`${actionLabel}${impact}，是否继续？`);
    }, [
        composerImages.length,
        composerSnapshot.parts.length,
        messageEditSession,
        referenceImage
    ]);

    const focusChatComposer = useCallback((): void => {
        window.requestAnimationFrame(() => composerRef.current?.focus());
    }, []);

    const handleConversationCreate = useCallback((): void => {
        resetComposerForConversationChange();
        createConversation();
        focusChatComposer();
    }, [createConversation, focusChatComposer, resetComposerForConversationChange]);

    const handleConversationSwitch = useCallback((conversationId: string): void => {
        resetComposerForConversationChange();
        switchConversation(conversationId);
        focusChatComposer();
    }, [focusChatComposer, resetComposerForConversationChange, switchConversation]);

    useEffect(() => {
        if (messageEditSession) return;
        const nextDraft = externalDraft?.trim();
        if (!nextDraft || externalDraftRevision === undefined) return;
        setInput(nextDraft);
        composerRef.current?.replaceText(nextDraft);
        window.requestAnimationFrame(() => composerRef.current?.focus());
    }, [externalDraft, externalDraftRevision, messageEditSession]);

    useEffect(() => {
        if (messageEditSession) return;
        const selection = selectedAssetContext;
        if (!selection) {
            capturedProjectAssetKeyRef.current = null;
            return;
        }
        const key = `${selection.relativePath}:${selection.name}`;
        if (capturedProjectAssetKeyRef.current === key) return;
        capturedProjectAssetKeyRef.current = key;
        const reference: ChatComposerReference = {
            version: 'chat-composer-reference/v0',
            referenceId: createComposerReferenceId('project-asset'),
            label: selection.name,
            sourceLabel: '项目素材',
            mediaKind: selection.imageType === 'video' ? 'video' : 'image',
            source: {
                kind: 'project_asset',
                relativePath: selection.relativePath,
                imageType: selection.imageType,
                folderType: selection.folderType
            },
            addedAt: new Date().toISOString()
        };
        insertComposerReference(reference, {
            kind: 'project_asset',
            context: { ...selection }
        });
        onClearSelectedAssetContext?.();
    }, [
        insertComposerReference,
        messageEditSession,
        onClearSelectedAssetContext,
        selectedAssetContext
    ]);

    useEffect(() => {
        if (messageEditSession) return;
        const request = eagleComposerInsertRequest;
        if (!request) return;
        insertEagleAssetRefsIntoComposer(request.assetRefs);
        onConsumeEagleComposerInsertRequest?.(request.revision);
    }, [
        eagleComposerInsertRequest,
        insertEagleAssetRefsIntoComposer,
        messageEditSession,
        onConsumeEagleComposerInsertRequest
    ]);

    useEffect(() => {
        if (messageEditSession) return;
        const activeBindings = new Set(knowledgeReferences.map((reference) => reference.bindingRef));
        for (const existing of Array.from(capturedKnowledgeBindingRefsRef.current)) {
            if (!activeBindings.has(existing)) capturedKnowledgeBindingRefsRef.current.delete(existing);
        }
        for (const selection of knowledgeReferences) {
            if (capturedKnowledgeBindingRefsRef.current.has(selection.bindingRef)) continue;
            capturedKnowledgeBindingRefsRef.current.add(selection.bindingRef);
            const useRole = selection.useRole || 'general';
            const reference: ChatComposerReference = {
                version: 'chat-composer-reference/v0',
                referenceId: createComposerReferenceId('knowledge'),
                label: selection.title,
                sourceLabel: KNOWLEDGE_REFERENCE_USE_ROLES[useRole].label,
                mediaKind: 'knowledge',
                source: {
                    kind: 'knowledge_selection',
                    bindingRef: selection.bindingRef,
                    resultId: selection.resultId,
                    title: selection.title,
                    sourceRevision: selection.sourceRevision,
                    contentFingerprint: selection.contentFingerprint,
                    useRole,
                    selection: {
                        ...selection,
                        allowedUses: [...selection.allowedUses]
                    }
                },
                addedAt: new Date().toISOString()
            };
            insertComposerReference(reference, {
                kind: 'knowledge_selection',
                context: {
                    ...selection,
                    allowedUses: [...selection.allowedUses]
                }
            });
            onRemoveKnowledgeReference?.(selection.bindingRef);
        }
    }, [
        insertComposerReference,
        knowledgeReferences,
        messageEditSession,
        onRemoveKnowledgeReference
    ]);
    
    // 参考图复刻面板状态
    const [showReplicator, setShowReplicator] = useState(false);
    
    // 可见执行反馈状态
    const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
    // 本轮运行中的设计任务卡（模型立卡 / 打勾后同步）。运行时它就是过程流的容器：
    // 过程步骤挂在「正在做」的条目下，而不是另开一个「正在设计」面板。
    const [liveTaskCard, setLiveTaskCard] = useState<DesignTaskCard | null>(null);
    const [showThinking, setShowThinking] = useState(false);
    const [liveActivity, setLiveActivity] = useState<LiveActivityState | null>(null);
    // 模型回合计秒：只在带 startedAt 的活动存在时每秒重绘一次，其余时间不跑定时器。
    const [liveActivityNowMs, setLiveActivityNowMs] = useState<number>(() => Date.now());
    useEffect(() => {
        if (typeof liveActivity?.startedAt !== 'number') return undefined;
        setLiveActivityNowMs(Date.now());
        const timer = window.setInterval(() => setLiveActivityNowMs(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [liveActivity]);
    const composerThinkingModelIds = resolveComposerThinkingModelIds(modelPreferences);
    const composerThinkingPreference = normalizeModelThinkingPreference(modelPreferences?.thinking);
    const canShowThinkingModeToggle = composerThinkingModelIds.length > 0;

    const handleToggleComposerThinking = useCallback(() => {
        const currentPreferences = useAppStore.getState().modelPreferences || modelPreferences;
        const currentThinking = normalizeModelThinkingPreference(currentPreferences?.thinking);
        setModelPreferences({ thinking: { enabled: !currentThinking.enabled } });
    }, [modelPreferences, setModelPreferences]);

    // 输入栏 Agent 模型选择器：与设置页读写同一 store 字段（modelPreferences.primaryModel），
    // 候选口径见 primary-model-options 模块（硬编码 + 持久化动态模型，按运行模式过滤）。
    const composerPrimaryModelId = modelPreferences?.primaryModel || '';
    // 输入栏列全渠道候选，由选择器按「本地 / 云端」分页展示；
    // 运行模式不在这里过滤列表——它跟着用户选中的模型走（见 handleSelectComposerPrimaryModel）。
    const composerModelGroups = useMemo(
        () => buildAllPrimaryModelOptionGroups(dynamicModels),
        [dynamicModels]
    );
    const canShowComposerModelSelect = composerModelGroups.length > 0 || !!composerPrimaryModelId;
    // 运行模式徽标：候选被过滤成这一份的原因，直接标在选择器面板上，
    // 免得用户以为「模型列表里怎么少了一半」。
    const composerRunModeLabel = COMPOSER_RUN_MODE_LABELS[
        normalizeModelRunMode(modelPreferences?.mode, modelPreferences?.primaryModel)
    ];

    const handleSelectComposerPrimaryModel = useCallback((nextModelIdRaw: string) => {
        const nextModelId = nextModelIdRaw.trim();
        if (!nextModelId) return;
        // 运行模式跟着模型走：选了本地模型就是本地模式，选了云端模型就是云端模式。
        // 用户不需要先去设置页切模式再回来选模型，也不会留下「模式说本地、Agent 模型是云端」的矛盾配置。
        // 渠道判不出来（动态拉取的新模型还没登记 source）时不动模式——不猜。
        const nextChannel = getModelById(nextModelId)?.source;
        const nextMode = nextChannel === 'local' || nextChannel === 'cloud' ? nextChannel : null;

        // 只写 store：zustand persist（partialize 含 modelPreferences）负责落盘，
        // App.tsx 同步 effect 会立即把同一快照投影到主进程；主进程冷启动则直接读取
        // 这份持久化 owner，不再依赖延迟回灌。
        setModelPreferences(nextMode
            ? { primaryModel: nextModelId, visualModel: nextModelId, mode: nextMode }
            : { primaryModel: nextModelId, visualModel: nextModelId });
    }, [setModelPreferences]);

    const composerModelSlot = useMemo(() => ({
        key: 'agent',
        label: 'Agent 模型',
        value: composerPrimaryModelId,
        onChange: handleSelectComposerPrimaryModel,
        hint: '同一个视觉多模态模型负责理解、看图、规划与 Photoshop 工具调用。'
    }), [
        composerPrimaryModelId,
        handleSelectComposerPrimaryModel
    ]);

    // 工具定义体积。
    //
    // 要量的是「每轮真正发给模型的那一份」，不是「已声明的全部」——两者差很多：
    // 已声明 158 个约 71k tokens，执行器实际只把 56 个放进循环、约 52k tokens。
    // 用前者会让面板高报近 20k，用户据此判断"快满了"就是被误导。
    //
    // selectToolsForContext 会构建完整能力会话（重依赖 + 读 store），所以走动态 import
    // 只算一次；算不出来时退回已声明集合，并在下方 uncounted 里说明口径。
    const [composerToolMeasurement, setComposerToolMeasurement] = useState<{
        tokens: number;
        exact: boolean;
    }>(() => ({ tokens: estimateToolSchemaTokens(getDefaultAgentTools()), exact: false }));

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const executor = await import('../services/skill-executors/autonomous-agent.executor');
            const activeTools = executor.selectToolsForContext({}, {});
            if (cancelled || !Array.isArray(activeTools) || activeTools.length === 0) return;
            setComposerToolMeasurement({ tokens: estimateToolSchemaTokens(activeTools), exact: true });
        })().catch(() => {
            // 保持已声明集合的估算值：宁可偏高也不显示 0，但 exact=false 会如实标注
        });
        return () => { cancelled = true; };
    }, []);

    const composerToolTokens = composerToolMeasurement.tokens;

    // 对话历史体积。
    //
    // 两个坑都在这里踩过，注释留着别再犯：
    // 1. 依赖不能只看 length 和最后一条 id —— 助手回复是用 updateMessage 往同一条消息里填的，
    //    条数和 id 都不变，只盯这两个会让整轮助手输出一个 token 都算不进来。
    //    store 的 updateMessage 走 .map() 产生新数组，所以直接依赖 messages 即可。
    // 2. 要量的是「真正注入模型的那一份」，不是整个会话。执行器会按窗口分档截断
    //    （条数 / 每条字符 / 总字符），聊了 200 条也只进最近十几条——
    //    照全量算会让面板显示的历史远大于实际发送量。
    const composerHistoryBudget = useMemo(
        () => buildConversationHistoryBudget(resolveModelContextWindow(composerPrimaryModelId)?.tokens),
        [composerPrimaryModelId]
    );

    const composerMessageTokens = useMemo(() => {
        // 预算最多取十几条，先在上游截断，避免长会话每次渲染都全量扫描
        const recent = (messages || []).slice(-40);
        const selection = selectAgentConversationContext({
            messages: recent.map((message: any) => ({
                id: message?.id,
                role: message?.role,
                content: typeof message?.content === 'string' ? message.content : ''
            })),
            maxEntries: composerHistoryBudget.maxEntries,
            maxCharactersPerEntry: composerHistoryBudget.maxCharactersPerEntry,
            maxTotalCharacters: composerHistoryBudget.maxTotalCharacters
        });
        return estimateTextTokens(selection.entries.map(entry => entry.content).join('\n'));
    }, [messages, composerHistoryBudget]);

    const composerContextUsage = useMemo(() => {
        const usage = buildContextWindowUsage({
            // 模型声明 > 渠道官方公布 > 都没有则退回 Agent 预算，依据一并带出
            modelContextWindow: resolveModelContextWindow(composerPrimaryModelId),
            agentBudgetTokens: buildAgentContextWindowBudget().maxTokens,
            toolTokens: composerToolTokens,
            messageTokens: composerMessageTokens
        });
        if (composerToolMeasurement.exact) return usage;
        return {
            ...usage,
            uncountedNotes: [
                ...usage.uncountedNotes,
                '工具定义按已声明的全集估算，实际进循环的会更少'
            ]
        };
    }, [composerPrimaryModelId, composerToolTokens, composerMessageTokens, composerToolMeasurement.exact]);

    const cachePrivatePublicPlanOperationRequests = useCallback((
        messageId: string | null | undefined,
        request?: AgentTaskPublicPlanExecutionRequest
    ) => {
        if (!messageId) return;
        const requestId = String(request?.requestId || '').trim();
        const ownerKey = buildPublicPlanPrivateOperationOwnerKey(messageId, requestId);
        const runtimeOperationRequests = extractRuntimeOperationRequestsFromPublicPlanExecutionRequest(request);
        if (ownerKey && runtimeOperationRequests.length > 0) {
            publicPlanPrivateOperationRequestsRef.current[ownerKey] = runtimeOperationRequests;
            savePublicPlanOperationVault({
                sourceMessageId: messageId,
                requestId,
                operationRequests: runtimeOperationRequests
            });
        } else if (ownerKey) {
            delete publicPlanPrivateOperationRequestsRef.current[ownerKey];
        }
    }, []);

    const buildPublicPlanMessagePayload = useCallback(<T extends {
        agentTaskPublicPlanExecutionRequest?: AgentTaskPublicPlanExecutionRequest;
        agentTaskPublicPlanControlledRun?: AgentTaskPublicPlanControlledRun;
    }>(payload: T): T => ({
        ...payload,
        agentTaskPublicPlanExecutionRequest: stripRuntimeParamsFromPublicPlanExecutionRequest(payload.agentTaskPublicPlanExecutionRequest),
        agentTaskPublicPlanControlledRun: stripRuntimeParamsFromPublicPlanControlledRun(payload.agentTaskPublicPlanControlledRun)
    }), []);

    type AddMessageInput = Parameters<typeof addMessage>[0];
    type UpdateMessageInput = Parameters<typeof updateMessage>[1];
    type AssistantMessageWithOriginInput = Omit<AddMessageInput, 'role' | 'assistantReplyOrigin'>;
    type AssistantMessageUpdateWithOriginInput = Omit<UpdateMessageInput, 'role' | 'assistantReplyOrigin'>;

    const addAssistantMessageWithOrigin = useCallback((
        message: AssistantMessageWithOriginInput,
        origin: AssistantReplyOrigin,
        conversationId?: string | null
    ) => {
        const payload = {
            ...message,
            role: 'assistant',
            assistantReplyOrigin: normalizeAssistantReplyOriginForRuntime(
                origin,
                message.content
            )
        } as AddMessageInput;
        return conversationId
            ? addMessageToConversation(conversationId, payload)
            : addMessage(payload);
    }, [addMessage, addMessageToConversation]);

    const updateAssistantMessageWithOrigin = useCallback((
        messageId: string,
        updates: AssistantMessageUpdateWithOriginInput,
        origin: AssistantReplyOrigin,
        conversationId?: string | null
    ) => {
        const payload = {
            ...updates,
            assistantReplyOrigin: normalizeAssistantReplyOriginForRuntime(
                origin,
                updates.content
            )
        } as UpdateMessageInput;
        if (conversationId) {
            updateMessageInConversation(conversationId, messageId, payload);
            return;
        }
        updateMessage(messageId, payload);
    }, [updateMessage, updateMessageInConversation]);

    const addLocalAssistantMessage = useCallback((
        message: AssistantMessageWithOriginInput,
        origin: AssistantReplyOrigin,
        options?: { conversationId?: string | null }
    ) => addAssistantMessageWithOrigin(message, origin, options?.conversationId), [addAssistantMessageWithOrigin]);

    const updateLocalAssistantMessage = useCallback((
        messageId: string,
        updates: AssistantMessageUpdateWithOriginInput,
        origin: AssistantReplyOrigin,
        options?: { conversationId?: string | null }
    ) => updateAssistantMessageWithOrigin(messageId, updates, origin, options?.conversationId), [updateAssistantMessageWithOrigin]);

    const addLocalStatusMessage = useCallback((
        content: string,
        source: string,
        extra?: Omit<AddMessageInput, 'role' | 'assistantReplyOrigin' | 'content'>
    ) => addLocalAssistantMessage({
        ...(extra || {}),
        content
    }, uiStatusReplyOrigin(source)), [addLocalAssistantMessage]);

    const addLocalToolSummaryMessage = useCallback((
        content: string,
        source: string,
        extra?: Omit<AddMessageInput, 'role' | 'assistantReplyOrigin' | 'content'>
    ) => addLocalAssistantMessage({
        ...(extra || {}),
        content
    }, toolSummaryReplyOrigin(source)), [addLocalAssistantMessage]);

    const addLocalBlockerMessage = useCallback((
        content: string,
        source: string,
        extra?: Omit<AddMessageInput, 'role' | 'assistantReplyOrigin' | 'content'>
    ) => addLocalAssistantMessage({
        ...(extra || {}),
        content
    }, deterministicBlockerReplyOrigin(source)), [addLocalAssistantMessage]);

    const isEditableConfirmationCard = (value: unknown): value is EditableConfirmationCard => {
        const card = value && typeof value === 'object' ? value as Partial<EditableConfirmationCard> : {};
        return card.version === 'interactive-card/v0'
            && card.kind === 'editable_confirmation'
            && card.payload?.version === 'editable-confirmation/v0';
    };

    const formatEditableConfirmationText = (
        card: EditableConfirmationCard,
        value: EditableConfirmationValue
    ): string => {
        return card.payload.fields
            .map((field) => {
                const raw = value.values[field.id];
                const rendered = typeof raw === 'boolean' ? (raw ? '是' : '否') : cleanInteractiveCardText(raw);
                return rendered ? `${field.label}：${rendered}` : '';
            })
            .filter(Boolean)
            .join('；');
    };
    
    // === 性能优化：缓存消息渲染回调 ===
    // 用于 MessageRenderer 的 action 处理（稳定引用）
    const handleMessageAction = useCallback((actionId: string, params?: Record<string, any>) => {
        console.log('[ChatPanel] 执行动作:', actionId, params);

        const normalizedActionId = (() => {
            const aliases: Record<string, string> = {
                copy: 'copyText',
                copy_text: 'copyText',
                'copy-to-clipboard': 'copyText',
                copyContent: 'copyText',
                insert_prompt: 'insertPrompt',
                fillInput: 'insertPrompt',
                reusePrompt: 'insertPrompt',
                open_file: 'openProjectFile',
                openFile: 'openProjectFile',
                openDocument: 'openProjectFile',
                switch_document: 'switchDocument',
                activateDocument: 'switchDocument',
                executeTool: 'runTool',
                retryTool: 'runTool',
                retry_tool: 'runTool',
                confirmInteractiveCard: 'submitInteractiveCard',
                submit_interactive_card: 'submitInteractiveCard'
            };
            return aliases[actionId] || normalizeSkillInteractiveCardAction(actionId) || actionId;
        })();

        const emitActionResult = (
            status: 'success' | 'failed' | 'skipped' | 'partial' | 'fallback',
            content: string,
            _details?: string,
            source = 'chat-action:result'
        ) => {
            const visibleContent = sanitizeUserVisibleAssistantBodyText(content)
                || sanitizeUserVisibleDiagnosticText(content)
                || '操作状态已更新。';
            if (status === 'skipped') {
                addLocalBlockerMessage(visibleContent, source);
            } else {
                addLocalToolSummaryMessage(visibleContent, source);
            }
        };

        void (async () => {
            try {
                const prepareInteractiveCardSubmission = async (
                    submission: InteractiveCardSubmission,
                    mode: 'record_or_resume' | 'resume_required'
                ): Promise<{
                    mode: 'record_only';
                } | {
                    mode: 'resume_operation';
                    request: InteractiveContinuationRequest;
                    sourceTask: string;
                    conversationId: string;
                    sourceMessageId: string;
                    nextSubmissions: InteractiveCardSubmission[];
                    operationIdentity: InteractiveContinuationOperationIdentity;
                    projectId: string;
                    projectPath: string;
                } | { error: string }> => {
                    const sourceMessageId = String(params?.sourceMessageId || '').trim();
                    const state = useAppStore.getState();
                    if (chatSubmissionInFlightRef.current || state.isLoading) {
                        return { error: '当前已有设计任务正在执行；确认卡尚未消费，请等待完成或先停止当前任务。' };
                    }
                    const conversationId = String(state.currentConversationId || '').trim();
                    const conversationBranchId = String(
                        state.conversations.find((conversation) => conversation.id === conversationId)?.branchId || ''
                    ).trim();
                    const sourceMessage = state.messages.find((message) => message.id === sourceMessageId);
                    const project = state.currentProject;
                    const projectId = String(project?.id || '').trim();
                    const projectPath = String(project?.path || '').trim();
                    const decision = buildInteractiveCardSubmissionDecision({
                        ownerMessage: sourceMessage,
                        submission,
                        mode,
                        ...(conversationId ? { conversationId } : {}),
                        ...(conversationBranchId ? { conversationBranchId } : {}),
                        ...(project?.id ? { projectId: String(project.id) } : {}),
                        ...(project?.path ? { projectPath: String(project.path) } : {})
                    });
                    if (decision.status === 'rejected') {
                        return { error: decision.message };
                    }
                    if (!conversationId) {
                        return { error: '当前对话不可用，确认内容尚未提交。' };
                    }
                    if (decision.status === 'record_only') {
                        const recorded = updateMessageInConversation(conversationId, sourceMessageId, {
                            interactiveCardSubmissions: decision.nextSubmissions
                        } as any);
                        if (!recorded) {
                            return { error: '确认记录没有写回来源消息，本轮不会提交。' };
                        }
                        return { mode: 'record_only' };
                    }
                    if (!handleSendRef.current) {
                        return { error: 'Agent 承接入口暂不可用，确认卡尚未消费。' };
                    }
                    const continuation = sourceMessage?.pendingInteractiveContinuation;
                    if (!continuation) {
                        return { error: '原挂起操作已经丢失，确认卡尚未消费。请重新发起任务。' };
                    }
                    const operationIdentity: InteractiveContinuationOperationIdentity = {
                        ...decision.request,
                        conversationId,
                        ...(projectId ? { projectId } : {}),
                        ...(projectPath ? { projectPath } : {})
                    };
                    const ledgerClaim = await claimInteractiveContinuationOperation({
                        ...operationIdentity,
                        submission,
                        continuation,
                        sourceCard: decision.sourceCard
                    });
                    if (!ledgerClaim.success) {
                        return { error: ledgerClaim.message };
                    }
                    const stateAfterClaim = useAppStore.getState();
                    const currentConversationId = String(stateAfterClaim.currentConversationId || '').trim();
                    const currentProjectId = String(stateAfterClaim.currentProject?.id || '').trim();
                    const currentProjectPath = String(stateAfterClaim.currentProject?.path || '').trim();
                    if (
                        currentConversationId !== conversationId
                        || currentProjectId !== projectId
                        || currentProjectPath.toLowerCase() !== projectPath.toLowerCase()
                    ) {
                        return {
                            error: '确认期间对话或项目已经切换；操作仍安全保留，但本轮不会启动。请返回原项目后再次确认。'
                        };
                    }
                    return {
                        mode: 'resume_operation',
                        request: decision.request,
                        sourceTask: decision.sourceTask,
                        conversationId,
                        sourceMessageId,
                        nextSubmissions: decision.nextSubmissions,
                        operationIdentity,
                        projectId,
                        projectPath
                    };
                };

                const finalizeResumedInteractiveCardSubmission = async (decision: {
                    conversationId: string;
                    sourceMessageId: string;
                    nextSubmissions: InteractiveCardSubmission[];
                    operationIdentity: InteractiveContinuationOperationIdentity;
                }): Promise<{
                    committed: boolean;
                    status?: 'succeeded' | 'failed' | 'unknown';
                    message: string;
                }> => {
                    let ledgerState = await getInteractiveContinuationOperation(
                        decision.operationIdentity.continuationId
                    );
                    if (ledgerState.record?.status === 'running') {
                        ledgerState = await markInteractiveContinuationOperationUnknown(
                            decision.operationIdentity.continuationId,
                            'Agent 调用已经返回，但操作账本仍处于 running，无法确认 Photoshop 是否完成写入。'
                        );
                    }
                    const status = ledgerState.record?.status;
                    if (status === 'claimed') {
                        return {
                            committed: false,
                            message: '确认操作尚未开始，卡片保持可重试状态。'
                        };
                    }
                    if (status !== 'succeeded' && status !== 'failed' && status !== 'unknown') {
                        return {
                            committed: false,
                            message: ledgerState.message || '无法读取确认操作终态，卡片不会被标记为完成。'
                        };
                    }
                    let executionMessage = '原确认操作已完成。';
                    if (status === 'failed') {
                        executionMessage = '后续执行未完成，具体原因见下方执行结果；未产生 Photoshop 修改，可以重新发起。';
                    } else if (status === 'unknown') {
                        executionMessage = ledgerState.record?.uncertaintyReason
                            || '执行状态不确定，请先检查 Photoshop；系统不会自动重放。';
                    }
                    const projectedSubmissions = decision.nextSubmissions.map((submission) => {
                        if (submission.cardId !== decision.operationIdentity.cardId) return submission;
                        return {
                            ...submission,
                            execution: {
                                status,
                                message: executionMessage
                            }
                        };
                    });
                    const committed = updateMessageInConversation(decision.conversationId, decision.sourceMessageId, {
                        interactiveCardSubmissions: projectedSubmissions
                    } as any);
                    return {
                        committed,
                        status,
                        message: executionMessage
                    };
                };

                const launchAgentInternalResume = async (input: {
                    launchKey: string;
                    request: AgentInternalResumeRequest;
                }): Promise<boolean> => {
                    const existingLaunch = internalResumeLaunchStates.get(input.launchKey);
                    if (existingLaunch?.status === 'in_flight') {
                        addLocalToolSummaryMessage(
                            '确认结果已经保存，Agent 正在从等待点继续处理。',
                            'interactive-resume:already-in-flight'
                        );
                        return true;
                    }
                    if (existingLaunch?.status === 'launched') {
                        addLocalToolSummaryMessage(
                            '确认结果已经保存，后续处理已经启动，无需重复提交。',
                            'interactive-resume:already-launched'
                        );
                        return true;
                    }
                    internalResumeLaunchStates.set(input.launchKey, {
                        request: input.request,
                        status: 'in_flight'
                    });
                    try {
                        const send = handleSendRef.current;
                        if (!send) {
                            internalResumeLaunchStates.set(input.launchKey, {
                                request: input.request,
                                status: 'retryable'
                            });
                            addLocalBlockerMessage(
                                '确认结果已经保存，但 Agent 承接入口暂不可用。请再次点击原确认按钮重试续跑。',
                                'interactive-resume:unavailable'
                            );
                            return false;
                        }
                        await send({
                            text: input.request.sourceTask,
                            internalResumeRequest: input.request,
                            expectedConversationId: input.request.scope.conversationId,
                            expectedProjectId: input.request.scope.projectId,
                            expectedProjectPath: input.request.scope.projectPath
                        });
                        internalResumeLaunchStates.set(input.launchKey, {
                            request: input.request,
                            status: 'launched'
                        });
                        return true;
                    } catch (error: any) {
                        internalResumeLaunchStates.set(input.launchKey, {
                            request: input.request,
                            status: 'retryable'
                        });
                        addLocalBlockerMessage(
                            `确认结果已经保存，但自动继续失败：${cleanInteractiveCardText(error?.message) || '请再次点击原确认按钮重试续跑。'}`,
                            'interactive-resume:failed'
                        );
                        return false;
                    }
                };

                const resumeAgentAfterRecordedReview = async (input: {
                    submission: InteractiveCardSubmission;
                    reviewLabel: string;
                    submissionInstanceKey: string;
                }): Promise<boolean> => {
                    const sourceMessageId = String(params?.sourceMessageId || '').trim();
                    const state = useAppStore.getState();
                    const conversationId = String(state.currentConversationId || '').trim();
                    const sourceMessage = state.messages.find((message) => message.id === sourceMessageId);
                    if (!sourceMessageId || !conversationId || !sourceMessage) {
                        addLocalBlockerMessage(
                            '复核结论已经写入，但原等待任务已不在当前对话中，无法自动继续。请返回原任务后再次点击确认。',
                            'interactive-review:resume-owner-missing'
                        );
                        return false;
                    }
                    const launchKey = `review:${input.submissionInstanceKey}`;
                    try {
                        // 叶子 Skill 原生 continuation 仍走一次性执行账本；确定性复核写入不绕过既有 owner。
                        if (sourceMessage.pendingInteractiveContinuation) {
                            const previousLaunch = internalResumeLaunchStates.get(launchKey);
                            if (previousLaunch?.status === 'in_flight' || previousLaunch?.status === 'launched') {
                                addLocalToolSummaryMessage(
                                    previousLaunch.status === 'in_flight'
                                        ? '复核结论已经保存，Agent 正在从等待点继续处理。'
                                        : '复核结论已经保存，后续处理已经启动，无需重复提交。',
                                    `interactive-review:${previousLaunch.status}`
                                );
                                return true;
                            }
                            const decision = await prepareInteractiveCardSubmission(input.submission, 'resume_required');
                            if ('error' in decision || decision.mode !== 'resume_operation') {
                                addLocalBlockerMessage(
                                    '复核结论已经写入，但原等待操作暂时无法恢复。请再次点击原确认按钮重试续跑。',
                                    'interactive-review:owned-resume-rejected'
                                );
                                return false;
                            }
                            const send = handleSendRef.current;
                            if (!send) {
                                addLocalBlockerMessage(
                                    '复核结论已经写入，但 Agent 承接入口暂不可用。请再次点击原确认按钮重试续跑。',
                                    'interactive-review:owned-resume-unavailable'
                                );
                                return false;
                            }
                            const ownedResumeRequest = buildAgentInternalResumeRequest({
                                kind: 'review_recorded',
                                sourceMessageId,
                                sourceTask: decision.sourceTask,
                                resolutionSummary: `用户已完成${input.reviewLabel}，结论已写入对应状态。`,
                                conversationId: decision.conversationId,
                                projectId: decision.projectId,
                                projectPath: decision.projectPath,
                                sourceRuntimeIdentity: sourceMessage.agentTaskPlanPresentation?.identity
                            });
                            if (ownedResumeRequest) {
                                internalResumeLaunchStates.set(launchKey, {
                                    request: ownedResumeRequest,
                                    status: 'in_flight'
                                });
                            }
                            await send({
                                text: decision.sourceTask,
                                interactiveContinuationRequest: decision.request,
                                expectedConversationId: decision.conversationId,
                                expectedProjectId: decision.projectId,
                                expectedProjectPath: decision.projectPath
                            });
                            const finalization = await finalizeResumedInteractiveCardSubmission(decision);
                            if (!finalization.committed) {
                                if (ownedResumeRequest) {
                                    internalResumeLaunchStates.set(launchKey, {
                                        request: ownedResumeRequest,
                                        status: 'retryable'
                                    });
                                }
                                addLocalBlockerMessage(
                                    finalization.message,
                                    'interactive-review:owned-resume-state-save-failed'
                                );
                                return false;
                            }
                            if (finalization.status !== 'succeeded') {
                                if (ownedResumeRequest) {
                                    internalResumeLaunchStates.set(launchKey, {
                                        request: ownedResumeRequest,
                                        status: 'retryable'
                                    });
                                }
                                return false;
                            }
                            if (ownedResumeRequest) {
                                internalResumeLaunchStates.set(launchKey, {
                                    request: ownedResumeRequest,
                                    status: 'launched'
                                });
                            }
                            return true;
                        }

                        const existingSubmissions = Array.isArray(sourceMessage.interactiveCardSubmissions)
                            ? sourceMessage.interactiveCardSubmissions
                            : [];
                        const nextSubmissions = existingSubmissions.some(
                            (submission) => submission.cardId === input.submission.cardId
                        )
                            ? existingSubmissions
                            : [...existingSubmissions, input.submission];
                        const recorded = updateMessageInConversation(conversationId, sourceMessageId, {
                            interactiveCardSubmissions: nextSubmissions
                        } as any);
                        if (!recorded) {
                            addLocalBlockerMessage(
                                '复核结论已经写入，但确认记录没有写回原等待消息。请再次点击原确认按钮重试续跑。',
                                'interactive-review:submission-save-failed'
                            );
                            return false;
                        }

                        const resumeContext = resolveInteractiveReviewResumeContext({
                            messages: state.messages,
                            sourceMessageId
                        });
                        // 独立复核卡不是等待点：只保存结论，不擅自启动新任务。
                        if (!resumeContext) {
                            if (sourceMessage.executionSummary?.status === 'awaiting_confirmation') {
                                addLocalBlockerMessage(
                                    '复核结论已经写入，但没有找到原任务内容，无法自动继续。请重新发送原任务。',
                                    'interactive-review:source-task-missing'
                                );
                            }
                            return false;
                        }
                        const projectId = String(state.currentProject?.id || '').trim();
                        const projectPath = String(state.currentProject?.path || '').trim();
                        const request = buildAgentInternalResumeRequest({
                            kind: 'review_recorded',
                            sourceMessageId,
                            sourceTask: resumeContext.sourceTask,
                            resolutionSummary: `用户已完成${input.reviewLabel}，结论已写入对应状态。`,
                            conversationId,
                            projectId,
                            projectPath,
                            sourceRuntimeIdentity: resumeContext.sourceRuntimeIdentity
                        });
                        if (!request) {
                            addLocalBlockerMessage(
                                '复核结论已经写入，但续跑身份不完整。请返回原任务后再次点击确认。',
                                'interactive-review:resume-request-invalid'
                            );
                            return false;
                        }
                        return launchAgentInternalResume({ launchKey, request });
                    } catch (error: any) {
                        addLocalBlockerMessage(
                            `复核结论已经写入，但自动继续失败：${cleanInteractiveCardText(error?.message) || '请再次点击原确认按钮重试续跑。'}`,
                            'interactive-review:resume-failed'
                        );
                        return false;
                    }
                };

                const resumeAgentAfterDestructiveResolution = async (input: {
                    cardId: string;
                    sourceTask: string;
                    kind: AgentInternalResumeKind;
                    resolutionSummary: string;
                }): Promise<boolean> => {
                    const state = useAppStore.getState();
                    const sourceMessageId = String(params?.sourceMessageId || '').trim();
                    const conversationId = String(state.currentConversationId || '').trim();
                    const sourceMessage = state.messages.find((message) => message.id === sourceMessageId);
                    const request = buildAgentInternalResumeRequest({
                        kind: input.kind,
                        sourceMessageId,
                        sourceTask: input.sourceTask,
                        resolutionSummary: input.resolutionSummary,
                        conversationId,
                        projectId: state.currentProject?.id,
                        projectPath: state.currentProject?.path,
                        sourceRuntimeIdentity: sourceMessage?.agentTaskPlanPresentation?.identity
                    });
                    if (!request) {
                        addLocalBlockerMessage(
                            '操作结果已经保存，但原等待任务身份不完整，无法自动继续。请重新发送原任务。',
                            'destructive-action:resume-request-invalid'
                        );
                        return false;
                    }
                    return launchAgentInternalResume({
                        launchKey: `destructive:${input.cardId}`,
                        request
                    });
                };

                switch (normalizedActionId) {
                    case 'copyText': {
                        const text = String(
                            params?.text ??
                            params?.value ??
                            params?.content ??
                            params?.summary ??
                            params?.payload?.text ??
                            ''
                        ).trim();
                        if (!text) {
                            emitActionResult('skipped', '没有可复制的内容。', 'text empty', 'ui.copyText');
                            return;
                        }
                        await navigator.clipboard.writeText(text);
                        emitActionResult('success', '已复制到剪贴板。', `length=${text.length}`, 'ui.copyText');
                        return;
                    }
                    case 'insertPrompt': {
                        const prompt = String(
                            params?.prompt ??
                            params?.text ??
                            params?.payload?.prompt ??
                            ''
                        ).trim();
                        if (!prompt) {
                            emitActionResult('skipped', '未提供可插入的内容。', 'prompt empty', 'ui.insertPrompt');
                            return;
                        }
                        setInput(prompt);
                        emitActionResult('success', '已填入输入框。', `length=${prompt.length}`, 'ui.insertPrompt');
                        return;
                    }
                    // 通用选择卡只携带用户答案，不创建业务 Skill 操作。提交后通过来源消息和 Runtime 身份
                    // 恢复原自主任务，禁止走普通发送管线新建一轮无归属任务。
                    case 'submitUserChoice': {
                        const text = String(params?.text ?? '').trim();
                        if (!text) {
                            emitActionResult('skipped', '没有选到内容。', 'choice empty', 'ui.submitUserChoice');
                            return;
                        }
                        const sourceMessageId = String(params?.sourceMessageId || '').trim();
                        const state = useAppStore.getState();
                        const conversationId = String(state.currentConversationId || '').trim();
                        const resumeContext = resolveInteractiveReviewResumeContext({
                            messages: state.messages,
                            sourceMessageId
                        });
                        if (!resumeContext || !conversationId) {
                            emitActionResult(
                                'skipped',
                                '原等待任务已经不在当前对话中，无法安全继续。请回到原任务重新选择。',
                                'choice owner missing',
                                'ui.submitUserChoice'
                            );
                            return;
                        }
                        const request = buildAgentInternalResumeRequest({
                            kind: 'user_choice_submitted',
                            sourceMessageId,
                            sourceTask: resumeContext.sourceTask,
                            resolutionSummary: `用户对交互卡的回答：${text}`,
                            conversationId,
                            projectId: state.currentProject?.id,
                            projectPath: state.currentProject?.path,
                            sourceRuntimeIdentity: resumeContext.sourceRuntimeIdentity
                        });
                        const send = handleSendRef.current;
                        if (!send || !request) {
                            emitActionResult('skipped', '原任务承接入口暂不可用，请回到原任务重新选择。', 'resume unavailable', 'ui.submitUserChoice');
                            return;
                        }
                        await send({
                            text: request.sourceTask,
                            internalResumeRequest: request,
                            expectedConversationId: request.scope.conversationId,
                            expectedProjectId: request.scope.projectId,
                            expectedProjectPath: request.scope.projectPath
                        });
                        return;
                    }
                    case 'openProjectFile': {
                        const query = String(
                            params?.query ??
                            params?.fileName ??
                            params?.name ??
                            params?.path ??
                            params?.payload?.query ??
                            ''
                        ).trim();
                        if (!query) {
                            emitActionResult('skipped', '缺少要打开的文件关键词。', 'query empty', 'openProjectFile');
                            return;
                        }
                        const result = await executeToolCall('openProjectFile', {
                            query,
                            type: params?.type || params?.payload?.type || 'all',
                            directory: params?.directory || params?.payload?.directory
                        });
                        if (result?.success) {
                            emitActionResult('success', `已尝试打开文件：${query}`, 'openProjectFile success', 'openProjectFile');
                        } else {
                            emitActionResult('failed', formatUserVisibleFailureContent('打开文件失败', result?.error), result?.error || 'openProjectFile failed', 'openProjectFile');
                        }
                        return;
                    }
                    case 'switchDocument': {
                        const documentName = String(
                            params?.documentName ??
                            params?.name ??
                            params?.query ??
                            params?.payload?.documentName ??
                            ''
                        ).trim();
                        if (!documentName) {
                            emitActionResult('skipped', '缺少文档名称。', 'documentName empty', 'switchDocument');
                            return;
                        }
                        const result = await executeToolCall('switchDocument', { documentName });
                        if (result?.success) {
                            emitActionResult('success', `已切换到文档：${documentName}`, 'switchDocument success', 'switchDocument');
                        } else {
                            emitActionResult('failed', formatUserVisibleFailureContent('切换文档失败', result?.error), result?.error || 'switchDocument failed', 'switchDocument');
                        }
                        return;
                    }
                    case 'runTool': {
                        const toolName = String(
                            params?.toolName ??
                            params?.tool ??
                            params?.retryTool ??
                            params?.name ??
                            params?.payload?.toolName ??
                            ''
                        ).trim();
                        if (!toolName) {
                            emitActionResult('skipped', '未指定要执行的操作。', 'toolName empty', 'runTool');
                            return;
                        }
                        const rawToolParams = (
                            params?.toolParams ??
                            params?.params ??
                            params?.payload?.toolParams ??
                            params?.payload?.params ??
                            {}
                        ) as Record<string, any>;
                        const toolParams = sanitizeUiActionToolParams(rawToolParams) as Record<string, any>;
                        const result = await executeToolCall(toolName, toolParams);
                        if (result?.success) {
                            emitActionResult('success', '操作已完成。', result?.message || 'runTool success', `tool:${toolName}`);
                        } else {
                            const code = result?.code ? `code=${result.code}` : '';
                            const err = result?.error || 'runTool failed';
                            emitActionResult('failed', formatUserVisibleFailureContent('操作失败', result?.error), [err, code].filter(Boolean).join(' | '), `tool:${toolName}`);
                        }
                        return;
                    }
                    case 'submitVisualObservationCard': {
                        const action = String((params?.value as { actionId?: string } | undefined)?.actionId || '');
                        const sourceCard = params?.card as VisualObservationBlockedCard | undefined;
                        if (!sourceCard) {
                            emitActionResult('skipped', '卡片数据缺失，请重新生成。', 'missing card', 'ui.submitVisualObservationCard');
                            return;
                        }
                        //  卡片动作走确定性控制器：直接得结果，绝不重入发送管线（不插用户消息/不重进 Thinking/不重跑 v5）
                        const cardResult = submitVisualObservationCardAction(sourceCard, action);
                        emitActionResult('skipped', cardResult.message, cardResult.code, 'ui.submitVisualObservationCard');
                        return;
                    }
                    case 'submitSkillInteractiveReview': {
                        const card = params?.card as InteractiveCardDefinition | undefined;
                        if (!card || card.version !== 'interactive-card/v0') {
                            emitActionResult('skipped', '业务复核卡片数据已失效，请重新生成。', 'invalid skill review card', 'ui.submitSkillInteractiveReview');
                            return;
                        }
                        const preparation = prepareSkillInteractiveReview(card, params?.value);
                        if (preparation.status === 'unsupported') {
                            emitActionResult('skipped', '业务复核卡片数据已失效，请重新生成。', 'invalid skill review card', 'ui.submitSkillInteractiveReview');
                            return;
                        }
                        const submissionInstanceKey = buildInteractiveCardSubmissionInstanceKey({
                            cardId: card.id,
                            sourceMessageId: params?.sourceMessageId,
                            sourceBlockId: params?.sourceBlockId
                        });
                        if (!submissionInstanceKey) {
                            emitActionResult('skipped', '业务复核卡片缺少提交身份，请重新生成。', 'skill-review-card-instance-missing', 'ui.submitSkillInteractiveReview');
                            return;
                        }
                        if (submittedSkillInteractiveReviewInstanceKeys.has(submissionInstanceKey)) {
                            const persisted = persistedInteractiveReviewSubmissions.get(submissionInstanceKey);
                            if (persisted) {
                                await resumeAgentAfterRecordedReview({
                                    ...persisted,
                                    submissionInstanceKey
                                });
                                return;
                            }
                            emitActionResult('skipped', '这张业务复核卡正在写入，请稍候。', 'skill-review-card-submission-in-flight', 'ui.submitSkillInteractiveReview');
                            return;
                        }
                        if (preparation.status === 'invalid') {
                            emitActionResult(
                                'skipped',
                                preparation.message,
                                'skill review validation failed',
                                'ui.submitSkillInteractiveReview'
                            );
                            return;
                        }
                        submittedSkillInteractiveReviewInstanceKeys.add(submissionInstanceKey);
                        let reviewPersisted = false;
                        try {
                            const persisted = preparation.persist();
                            reviewPersisted = true;
                            const submission = preparation.submission;
                            persistedInteractiveReviewSubmissions.set(submissionInstanceKey, {
                                submission,
                                reviewLabel: preparation.reviewLabel
                            });
                            addLocalToolSummaryMessage(
                                persisted.summary,
                                `interactive-card:${submission.kind}-recorded`
                            );
                            await resumeAgentAfterRecordedReview({
                                submission,
                                reviewLabel: preparation.reviewLabel,
                                submissionInstanceKey
                            });
                        } catch (error: any) {
                            if (!reviewPersisted) {
                                submittedSkillInteractiveReviewInstanceKeys.delete(submissionInstanceKey);
                            }
                            emitActionResult(
                                'failed',
                                `业务复核写入失败：${cleanInteractiveCardText(error?.message) || '本地台账不可用'}`,
                                'skill review persistence failed',
                                'ui.submitSkillInteractiveReview'
                            );
                        }
                        return;
                    }
                    case 'submitDesignProjectRuleReviewCard': {
                        const card = params?.card;
                        if (!isDesignProjectRuleReviewCard(card)) {
                            emitActionResult('skipped', '项目规则复核卡片已失效，请重新读取项目状态。', 'invalid design project rule review card', 'ui.submitDesignProjectRuleReviewCard');
                            return;
                        }
                        const submissionInstanceKey = buildInteractiveCardSubmissionInstanceKey({
                            cardId: card.id,
                            sourceMessageId: params?.sourceMessageId,
                            sourceBlockId: params?.sourceBlockId
                        });
                        if (!submissionInstanceKey) {
                            emitActionResult('skipped', '项目规则复核卡缺少提交身份，请重新读取项目状态。', 'design-project-rule-review-instance-missing', 'ui.submitDesignProjectRuleReviewCard');
                            return;
                        }
                        if (submittedDesignProjectRuleReviewCardInstanceKeys.has(submissionInstanceKey)) {
                            const persisted = persistedInteractiveReviewSubmissions.get(submissionInstanceKey);
                            if (persisted) {
                                await resumeAgentAfterRecordedReview({
                                    ...persisted,
                                    submissionInstanceKey
                                });
                                return;
                            }
                            emitActionResult('skipped', '这张项目规则复核卡正在写入，请稍候。', 'design-project-rule-review-submission-in-flight', 'ui.submitDesignProjectRuleReviewCard');
                            return;
                        }
                        const validation = validateDesignProjectRuleReviewCardValue(card.payload, params?.value);
                        if (!validation.canSubmit) {
                            emitActionResult('skipped', validation.blockers.slice(0, 4).join('\n') || '规则复核内容没有通过检查。', 'design-project-rule-review-validation-failed', 'ui.submitDesignProjectRuleReviewCard');
                            return;
                        }
                        const projectPath = useAppStore.getState().currentProject?.path;
                        const designEcho = (window as any).designEcho;
                        if (!projectPath || typeof designEcho?.getDesignState !== 'function' || typeof designEcho?.updateDesignState !== 'function') {
                            emitActionResult('failed', '项目规则复核写入失败：当前项目状态服务不可用。', 'design state service unavailable', 'ui.submitDesignProjectRuleReviewCard');
                            return;
                        }
                        submittedDesignProjectRuleReviewCardInstanceKeys.add(submissionInstanceKey);
                        let reviewPersisted = false;
                        try {
                            const current = await designEcho.getDesignState(projectPath);
                            if (!current?.success || !doesDesignProjectRuleReviewCardMatchState({ card, state: current.state, projectIdentity: projectPath })) {
                                submittedDesignProjectRuleReviewCardInstanceKeys.delete(submissionInstanceKey);
                                emitActionResult('skipped', '项目规则在复核期间已经变化，请重新读取后再确认。', 'design-project-rule-review-stale', 'ui.submitDesignProjectRuleReviewCard');
                                return;
                            }
                            const updated = await designEcho.updateDesignState(projectPath, buildDesignProjectRuleReviewPatch({
                                card,
                                value: validation.normalizedValue
                            }));
                            if (!updated?.success) throw new Error(updated?.error || '项目状态没有返回成功结果');
                            reviewPersisted = true;
                            const submission = buildInteractiveCardSubmission({ card, value: validation.normalizedValue, validation });
                            persistedInteractiveReviewSubmissions.set(submissionInstanceKey, {
                                submission,
                                reviewLabel: '项目与品牌规则复核'
                            });
                            addLocalToolSummaryMessage(
                                [
                                    '项目与品牌规则复核结论已写入。',
                                    getDesignProjectRuleReviewCardSummary(updated.state),
                                    '规则只约束质量和交付判断，不会授予 Photoshop 或外部动作权限。'
                                ].join('\n'),
                                'interactive-card:design-project-rule-review-recorded'
                            );
                            await resumeAgentAfterRecordedReview({
                                submission,
                                reviewLabel: '项目与品牌规则复核',
                                submissionInstanceKey
                            });
                        } catch (error: any) {
                            if (!reviewPersisted) {
                                submittedDesignProjectRuleReviewCardInstanceKeys.delete(submissionInstanceKey);
                            }
                            emitActionResult('failed', `项目规则复核写入失败：${cleanInteractiveCardText(error?.message) || '本地项目状态不可用'}`, 'design project rule review persistence failed', 'ui.submitDesignProjectRuleReviewCard');
                        }
                        return;
                    }
                    case 'submitDesignProjectFactReviewCard': {
                        const card = params?.card;
                        if (!isDesignProjectFactReviewCard(card)) {
                            emitActionResult('skipped', '项目事实复核卡片已失效，请重新读取项目状态。', 'invalid design project fact review card', 'ui.submitDesignProjectFactReviewCard');
                            return;
                        }
                        const submissionInstanceKey = buildInteractiveCardSubmissionInstanceKey({
                            cardId: card.id,
                            sourceMessageId: params?.sourceMessageId,
                            sourceBlockId: params?.sourceBlockId
                        });
                        if (!submissionInstanceKey) {
                            emitActionResult('skipped', '项目事实复核卡缺少提交身份，请重新读取项目状态。', 'design-project-fact-review-instance-missing', 'ui.submitDesignProjectFactReviewCard');
                            return;
                        }
                        if (submittedDesignProjectFactReviewCardInstanceKeys.has(submissionInstanceKey)) {
                            const persisted = persistedInteractiveReviewSubmissions.get(submissionInstanceKey);
                            if (persisted) {
                                await resumeAgentAfterRecordedReview({
                                    ...persisted,
                                    submissionInstanceKey
                                });
                                return;
                            }
                            emitActionResult('skipped', '这张项目事实复核卡正在写入，请稍候。', 'design-project-fact-review-submission-in-flight', 'ui.submitDesignProjectFactReviewCard');
                            return;
                        }
                        const validation = validateDesignProjectFactReviewCardValue(card.payload, params?.value);
                        if (!validation.canSubmit) {
                            emitActionResult(
                                'skipped',
                                validation.blockers.slice(0, 4).join('\n') || '项目事实复核信息不完整。',
                                'design project fact review validation failed',
                                'ui.submitDesignProjectFactReviewCard'
                            );
                            return;
                        }
                        const projectPath = useAppStore.getState().currentProject?.path;
                        const designEcho = (window as any).designEcho;
                        if (!projectPath || typeof designEcho?.getDesignState !== 'function' || typeof designEcho?.updateDesignState !== 'function') {
                            emitActionResult('failed', '项目事实复核写入失败：当前项目状态服务不可用。', 'design state service unavailable', 'ui.submitDesignProjectFactReviewCard');
                            return;
                        }
                        submittedDesignProjectFactReviewCardInstanceKeys.add(submissionInstanceKey);
                        let reviewPersisted = false;
                        try {
                            const current = await designEcho.getDesignState(projectPath);
                            if (
                                current?.success !== true
                                || !doesDesignProjectFactReviewCardMatchState({
                                    card,
                                    state: current.state,
                                    projectIdentity: projectPath
                                })
                            ) {
                                submittedDesignProjectFactReviewCardInstanceKeys.delete(submissionInstanceKey);
                                emitActionResult('skipped', '项目事实在复核期间已经变化，请重新读取后再确认。', 'design-project-fact-review-stale', 'ui.submitDesignProjectFactReviewCard');
                                return;
                            }
                            const patch = buildDesignProjectFactReviewPatch({
                                card,
                                value: validation.normalizedValue
                            });
                            const updated = await designEcho.updateDesignState(projectPath, patch);
                            if (updated?.success !== true) {
                                throw new Error(updated?.error || '项目状态没有返回成功结果');
                            }
                            reviewPersisted = true;
                            const submission = buildInteractiveCardSubmission({
                                card,
                                value: validation.normalizedValue,
                                validation
                            });
                            persistedInteractiveReviewSubmissions.set(submissionInstanceKey, {
                                submission,
                                reviewLabel: '项目商品事实复核'
                            });
                            addLocalToolSummaryMessage(
                                [
                                    '项目事实复核结论已写入。',
                                    getDesignProjectFactReviewCardSummary(updated.state),
                                    '未确认、已驳回或已被取代的事实不会用于通过设计质量检查。'
                                ].join('\n'),
                                'interactive-card:design-project-fact-review-recorded'
                            );
                            await resumeAgentAfterRecordedReview({
                                submission,
                                reviewLabel: '项目商品事实复核',
                                submissionInstanceKey
                            });
                        } catch (error: any) {
                            if (!reviewPersisted) {
                                submittedDesignProjectFactReviewCardInstanceKeys.delete(submissionInstanceKey);
                            }
                            emitActionResult(
                                'failed',
                                `项目事实复核写入失败：${cleanInteractiveCardText(error?.message) || '本地项目状态不可用'}`,
                                'design project fact review persistence failed',
                                'ui.submitDesignProjectFactReviewCard'
                            );
                        }
                        return;
                    }
                    case 'submitInteractiveCard': {
                        const card = params?.card;
                        if (isEditableConfirmationCard(card)) {
                            const validation = validateEditableConfirmationValue(card.payload, params?.value);
                            if (!validation.canSubmit) {
                                emitActionResult(
                                    'skipped',
                                    validation.blockers.slice(0, 4).join('\n') || '内容还没有通过检查，请先修改。',
                                    'interactive card validation failed',
                                    'ui.submitInteractiveCard'
                                );
                                return;
                            }

                            const submissionInstanceKey = buildInteractiveCardSubmissionInstanceKey({
                                cardId: card.id,
                                sourceMessageId: params?.sourceMessageId,
                                sourceBlockId: params?.sourceBlockId
                            });
                            if (!submissionInstanceKey) {
                                emitActionResult(
                                    'skipped',
                                    '可编辑卡片缺少来源身份，请重新生成。',
                                    'editable-card-instance-missing',
                                    'ui.submitInteractiveCard'
                                );
                                return;
                            }

                            const memoryCandidate = card.memoryPolicy?.enabled
                                ? buildEditableConfirmationApprovedMemory({
                                    card,
                                    value: validation.normalizedValue,
                                    scope: card.memoryPolicy.scope,
                                    confirmedBy: 'user'
                                })
                                : undefined;
                            const submission = buildInteractiveCardSubmission({
                                card,
                                value: validation.normalizedValue,
                                validation,
                                memoryCandidate
                            });
                            const decision = await prepareInteractiveCardSubmission(submission, 'record_or_resume');
                            if ('error' in decision) {
                                emitActionResult('skipped', decision.error, 'interactive card submission rejected', 'ui.submitInteractiveCard');
                                return;
                            }
                            let memoryId = '';
                            let memoryError = '';
                            if (memoryCandidate) {
                                try {
                                    memoryId = getMemoryService().recordUserConfirmedDesignMemoryItem(memoryCandidate).id;
                                } catch (error: any) {
                                    memoryError = cleanInteractiveCardText(error?.message) || '记忆保存失败';
                                }
                            }
                            const confirmationText = formatEditableConfirmationText(card, validation.normalizedValue);
                            addLocalToolSummaryMessage(
                                [
                                    `已确认：${card.title}`,
                                    confirmationText,
                                    memoryId ? '已保存为可复用内容。' : '',
                                    memoryError ? `内容已确认，但记忆没有保存：${memoryError}` : ''
                                ].filter(Boolean).join('\n'),
                                'interactive-card:editable-confirmed'
                            );
                            if (decision.mode === 'resume_operation') {
                                const send = handleSendRef.current;
                                if (!send) {
                                    throw new Error('Agent 承接入口暂不可用，确认操作仍保留在执行账本中。');
                                }
                                await send({
                                    text: decision.sourceTask,
                                    interactiveContinuationRequest: decision.request,
                                    expectedConversationId: decision.conversationId,
                                    expectedProjectId: decision.projectId,
                                    expectedProjectPath: decision.projectPath
                                });
                                const finalization = await finalizeResumedInteractiveCardSubmission(decision);
                                if (!finalization.committed) {
                                    addLocalBlockerMessage(
                                        finalization.message,
                                        'interactive-card:submission-state-save-failed'
                                    );
                                }
                            } else {
                                persistedInteractiveReviewSubmissions.set(submissionInstanceKey, {
                                    submission,
                                    reviewLabel: `「${card.title}」结构化内容确认`
                                });
                                await resumeAgentAfterRecordedReview({
                                    submission,
                                    reviewLabel: `「${card.title}」结构化内容确认`,
                                    submissionInstanceKey
                                });
                            }
                            return;
                        }
                        const skillCardPreparation = prepareSkillInteractiveCardSubmission(
                            card as InteractiveCardDefinition,
                            params?.value
                        );
                        if (skillCardPreparation.status === 'unsupported') {
                            emitActionResult('skipped', '这张确认卡片暂时不能提交，请重新生成。', 'unsupported interactive card', 'ui.submitInteractiveCard');
                            return;
                        }
                        if (skillCardPreparation.status === 'invalid') {
                            emitActionResult(
                                'skipped',
                                skillCardPreparation.message,
                                'interactive card validation failed',
                                'ui.submitInteractiveCard'
                            );
                            return;
                        }
                        const submission = skillCardPreparation.submission;
                        const decision = await prepareInteractiveCardSubmission(submission, 'resume_required');
                        if ('error' in decision) {
                            emitActionResult('skipped', decision.error, 'interactive continuation claim rejected', 'ui.submitInteractiveCard');
                            return;
                        }
                        if (decision.mode !== 'resume_operation') {
                            emitActionResult(
                                'skipped',
                                '业务确认卡没有绑定可恢复的 Skill 操作，本轮不会执行。请重新发起原任务。',
                                'skill interactive continuation missing',
                                'ui.submitInteractiveCard'
                            );
                            return;
                        }
                        let memoryId = '';
                        let memoryError = '';
                        if (submission.memoryCandidate) {
                            try {
                                memoryId = getMemoryService().recordUserConfirmedDesignMemoryItem(submission.memoryCandidate).id;
                            } catch (error: any) {
                                memoryError = cleanInteractiveCardText(error?.message) || '记忆保存失败';
                            }
                        }
                        addLocalToolSummaryMessage(
                            [
                                skillCardPreparation.confirmationText,
                                memoryId ? skillCardPreparation.memorySavedText : '',
                                memoryError ? `${skillCardPreparation.memoryFailurePrefix}：${memoryError}` : ''
                                ].filter(Boolean).join('\n'),
                            `interactive-card:${submission.kind}-confirmed`
                        );
                        const send = handleSendRef.current;
                        if (!send) {
                            throw new Error('Agent 承接入口暂不可用，确认操作仍保留在执行账本中。');
                        }
                        await send({
                            text: decision.sourceTask,
                            interactiveContinuationRequest: decision.request,
                            expectedConversationId: decision.conversationId,
                            expectedProjectId: decision.projectId,
                            expectedProjectPath: decision.projectPath
                        });
                        const finalization = await finalizeResumedInteractiveCardSubmission(decision);
                        if (!finalization.committed) {
                            addLocalBlockerMessage(
                                finalization.message,
                                'interactive-card:skill-submission-state-save-failed'
                            );
                        }
                        return;
                    }
                    case 'submitDestructiveActionCard': {
                        // V1-7b 正版 HITL 确定性重放：点卡后由确定性控制器直接得结果，绝不重入模型轮生成调用
                        // ——重放的必是卡片暂存的原始调用（红线 B）。
                        const card = params?.card as PendingDestructiveActionCard | undefined;
                        const actionId = String((params?.value as { actionId?: string } | undefined)?.actionId || '');
                        const submission = resolvePendingDestructiveActionSubmission(card, actionId);
                        if (submission.type === 'rejected') {
                            emitActionResult('skipped', submission.message, submission.code, 'ui.submitDestructiveActionCard');
                            return;
                        }
                        // 幂等：一张卡只处理一次（execute/cancel 均消费），防重复点击=重复重放（浏览器 click 重复=重复下单/支付）。
                        const destructiveCardId = submission.card.id;
                        if (submittedDestructiveActionCardIds.has(destructiveCardId)) {
                            const launch = internalResumeLaunchStates.get(`destructive:${destructiveCardId}`);
                            if (launch) {
                                await launchAgentInternalResume({
                                    launchKey: `destructive:${destructiveCardId}`,
                                    request: launch.request
                                });
                                return;
                            }
                            emitActionResult('skipped', '这个操作正在处理，请稍候。', 'destructive-card-resolution-in-flight', 'ui.submitDestructiveActionCard');
                            return;
                        }
                        submittedDestructiveActionCardIds.add(destructiveCardId);
                        if (submission.type === 'cancelled') {
                            addLocalToolSummaryMessage(
                                `已取消该操作：${submission.card.payload.targetSummary}`,
                                'interactive-card:destructive-cancelled'
                            );
                            const cancelledSourceTask = String(submission.card.payload.sourceTask || '').trim();
                            await resumeAgentAfterDestructiveResolution({
                                cardId: destructiveCardId,
                                sourceTask: cancelledSourceTask,
                                kind: 'destructive_action_cancelled',
                                resolutionSummary: `用户未批准操作“${submission.card.payload.targetSummary}”；不要执行该操作，改用非破坏性路径继续。`
                            });
                            return;
                        }
                        // submission.type === 'execute'：确定性重放暂存的原始调用（已注入确认参数），走直连执行路径
                        const replayResult = await executeToolCall(submission.toolName, submission.params);
                        if (replayResult?.success !== false) {
                            addLocalToolSummaryMessage(
                                `已确认并执行：${submission.card.payload.targetSummary}`,
                                'interactive-card:destructive-executed'
                            );
                            const confirmedSourceTask = String(submission.card.payload.sourceTask || '').trim();
                            await resumeAgentAfterDestructiveResolution({
                                cardId: destructiveCardId,
                                sourceTask: confirmedSourceTask,
                                kind: 'destructive_action_executed',
                                resolutionSummary: `用户已批准并完成操作“${submission.card.payload.targetSummary}”；不要重复执行，基于最新环境继续。`
                            });
                        } else {
                            emitActionResult('failed', formatUserVisibleFailureContent('操作执行失败', replayResult?.error), replayResult?.error || 'destructive replay failed', `tool:${submission.toolName}`);
                            await resumeAgentAfterDestructiveResolution({
                                cardId: destructiveCardId,
                                sourceTask: String(submission.card.payload.sourceTask || '').trim(),
                                kind: 'destructive_action_failed',
                                resolutionSummary: `用户已批准操作“${submission.card.payload.targetSummary}”，但执行失败：${replayResult?.error || '未知错误'}。不要盲目重复同一操作。`
                            });
                        }
                        return;
                    }
                    case 'confirmPublicPlan': {
                        const sourceMessageId = String(
                            params?.sourceMessageId ??
                            params?.messageId ??
                            params?.payload?.sourceMessageId ??
                            ''
                        ).trim();
                        const sourceMessage = useAppStore.getState().messages
                            .find(message => message.id === sourceMessageId) as any;
                        const request = sourceMessage?.agentTaskPublicPlanExecutionRequest;
                        const requestId = String(request?.requestId || '').trim();
                        const operationOwnerKey = buildPublicPlanPrivateOperationOwnerKey(sourceMessageId, requestId);
                        if (!sourceMessageId || !requestId || request?.status !== 'blocked_pending_user_confirmation') {
                            emitActionResult('skipped', '这条计划已经不可确认，请重新生成计划。', 'public plan request missing or not pending', 'ui.confirmPublicPlan');
                            return;
                        }
                        if (sourceMessage?.agentTaskPublicPlanApprovalRecord?.status === 'approved_controlled_execution_request') {
                            emitActionResult('skipped', '这条计划已经确认并处理过，无需重复执行。', 'public plan already approved', 'ui.confirmPublicPlan');
                            return;
                        }
                        const inMemoryOperationRequests = publicPlanPrivateOperationRequestsRef.current[operationOwnerKey];
                        const runtimeOperationRequests = Array.isArray(inMemoryOperationRequests)
                            && inMemoryOperationRequests.length > 0
                            ? inMemoryOperationRequests
                            : loadPublicPlanOperationVault({
                                sourceMessageId,
                                requestId
                            });
                        if (runtimeOperationRequests.length === 0) {
                            emitActionResult(
                                'failed',
                                '这条计划的受控执行参数已经丢失，本轮不会写入 Photoshop。请重新生成计划后再确认。',
                                'public plan private operation requests missing',
                                'ui.confirmPublicPlan'
                            );
                            return;
                        }
                        publicPlanPrivateOperationRequestsRef.current[operationOwnerKey] = runtimeOperationRequests;
                        const shouldUseDisposableLiveAdapter = Array.isArray(runtimeOperationRequests)
                            && runtimeOperationRequests.some(operation => (
                                operation?.toolName === 'createDocument'
                                || operation?.toolName === 'renderLayout'
                            ));
                        await handleSendRef.current?.({
                            text: '确认计划',
                            publicPlanConfirmationSourceMessageId: sourceMessageId,
                            publicPlanConfirmationRequestId: requestId,
                            publicPlanDisposableLiveAdapter: shouldUseDisposableLiveAdapter
                        });
                        const updatedSourceMessage = useAppStore.getState().messages
                            .find(message => message.id === sourceMessageId) as any;
                        if (updatedSourceMessage?.agentTaskPublicPlanApprovalRecord?.status === 'approved_controlled_execution_request') {
                            removePublicPlanOperationVault(sourceMessageId);
                            delete publicPlanPrivateOperationRequestsRef.current[operationOwnerKey];
                        }
                        return;
                    }
                    default:
                        emitActionResult('skipped', '这个界面动作暂时不可用。', `unsupported action: ${actionId}`, `ui.${normalizedActionId}`);
                        return;
                }
            } catch (error: any) {
                emitActionResult('failed', formatUserVisibleFailureContent('动作执行失败', error), error?.message || 'action exception', `ui.${normalizedActionId}`);
            }
        })();
    }, [addMessage]);
    
    // 可见执行反馈辅助函数
    const addThinkingStep = (step: Omit<ThinkingStep, 'id' | 'timestamp'>) => {
        const newStep: ThinkingStep = {
            ...step,
            id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now()
        };
        setThinkingSteps(prev => [...prev, newStep]);
        return newStep.id;
    };
    
    const updateThinkingStep = (stepId: string, updates: Partial<ThinkingStep>) => {
        setThinkingSteps(prev => prev.map(step => 
            step.id === stepId ? { ...step, ...updates } : step
        ));
    };
    
    const clearThinkingSteps = (hideThinking: boolean = true) => {
        setThinkingSteps([]);
        setLiveActivity(null);
        setLiveTaskCard(null);
        if (hideThinking) {
            setShowThinking(false);
        }
    };

    const finalizeAgentRunStopped = (
        runId: string,
        source: string,
        resultProjection?: {
            executionSummary?: AgentExecutionSummary;
            agentTaskPlanPresentation?: AgentTaskPlanPresentation;
        }
    ): boolean => {
        const ui = activeAgentRunUiRef.current;
        if (!ui || ui.runId !== runId) return false;

        cancelledAgentRunIdsRef.current.add(runId);
        const preservedSteps = normalizeStoppedVisibleProcessSteps(ui.visibleSteps);
        const interruption = buildUserStoppedResponseInterruption();
        const resultProjectionUpdate: UpdateMessageInput = {
            ...(resultProjection?.executionSummary
                ? { executionSummary: resultProjection.executionSummary }
                : {}),
            ...(resultProjection?.agentTaskPlanPresentation
                ? { agentTaskPlanPresentation: resultProjection.agentTaskPlanPresentation }
                : {})
        };
        const terminalUpdate: UpdateMessageInput = {
            isThinking: false,
            agentResponseInterruption: interruption,
            ...(preservedSteps ? { thinkingSteps: preservedSteps } : {}),
            ...resultProjectionUpdate
        };
        const state = useAppStore.getState();
        const targetConversationId = ui.conversationId || state.currentConversationId;
        const targetConversationExists = Boolean(
            targetConversationId
            && state.conversations.some((conversation) => conversation.id === targetConversationId)
        );
        let didPresentTerminalState = false;

        if (ui.stopMessageShown) {
            if (!ui.streamedAssistantMessageId || !targetConversationId || !resultProjection) return false;
            didPresentTerminalState = updateMessageInConversation(
                targetConversationId,
                ui.streamedAssistantMessageId,
                resultProjectionUpdate
            );
            if (didPresentTerminalState) useAppStore.getState().saveCurrentProjectConversations();
            return didPresentTerminalState;
        }

        if (ui.streamedAssistantMessageId && targetConversationId) {
            // 保留模型已经输出的正文和 model_authored 来源，只附加 Harness 拥有的停止终态。
            didPresentTerminalState = updateMessageInConversation(
                targetConversationId,
                ui.streamedAssistantMessageId,
                terminalUpdate
            );
        } else if (targetConversationId && targetConversationExists) {
            // 尚无正文时也落一条结构化、可渲染的停止终态；不再依赖 Thinking 是否会被 parser 保留。
            ui.streamedAssistantMessageId = addLocalAssistantMessage({
                content: '',
                isThinking: false,
                agentResponseInterruption: interruption,
                ...(preservedSteps ? { thinkingSteps: preservedSteps } : {}),
                ...resultProjectionUpdate
            }, uiStatusReplyOrigin(source), { conversationId: targetConversationId });
            didPresentTerminalState = true;
        }

        if (!didPresentTerminalState) {
            console.warn('[ChatPanel] 用户停止终态未写入：目标会话或流式消息已不存在', {
                runId,
                conversationId: targetConversationId,
                streamedAssistantMessageId: ui.streamedAssistantMessageId
            });
            clearThinkingSteps();
            return false;
        }

        // 停止终态属于用户刚触发的关键生命周期事实，不能等待普通消息的 2 秒防抖保存。
        useAppStore.getState().saveCurrentProjectConversations();
        ui.stopMessageShown = true;
        clearThinkingSteps();
        return true;
    };

    const markActiveAgentRunStopped = () => {
        const runId = activeAgentRunIdRef.current;
        if (!runId) return;
        finalizeAgentRunStopped(runId, 'agent-run:user-stopped');
    };

    const resetMessageEditSession = useCallback((restoreFocus: boolean = false): void => {
        const editedMessageId = messageEditSession?.messageId || '';
        messageEditRuntimeReferencesRef.current.clear();
        messageEditImagesRef.current = [];
        setMessageEditSession(null);
        setMessageEditSnapshot({ parts: [], text: '', referenceCount: 0 });
        setMessageEditError('');
        setMessageEditSubmitting(false);
        if (!restoreFocus || !editedMessageId) return;
        window.requestAnimationFrame(() => {
            const messageElement = Array.from(
                document.querySelectorAll<HTMLElement>('[data-message-id]')
            ).find((element) => element.dataset.messageId === editedMessageId);
            messageElement
                ?.querySelector<HTMLButtonElement>('[data-message-edit-trigger]')
                ?.focus();
        });
    }, [messageEditSession?.messageId]);

    /** 在原用户气泡中开启独立编辑会话；不改动底部新消息草稿。 */
    const handleStartEdit = useCallback((message: ComposerEditableMessage): void => {
        if (messageEditSession) return;
        const state = useAppStore.getState();
        const conversationId = String(state.currentConversationId || '').trim();
        const projectId = String(state.currentProject?.id || '').trim();
        const projectPath = String(state.currentProject?.path || '').trim();
        if (!conversationId) return;

        const payload = buildEditableComposerPayload(message);
        messageEditRuntimeReferencesRef.current = buildPersistedComposerRuntimeReferences(
            payload.parts,
            projectPath
        );
        messageEditImagesRef.current = payload.images.map((image) => ({ ...image }));

        const previewUrls: Record<string, string> = {};
        const imagesById = new Map(payload.images.map((image) => [image.id, image]));
        for (const part of payload.parts) {
            if (part.type !== 'reference' || part.reference.source.kind !== 'uploaded_image') continue;
            const image = imagesById.get(part.reference.source.imageId);
            if (!image) continue;
            previewUrls[part.reference.referenceId] = `data:${image.mediaType};base64,${image.data}`;
        }

        let warning = '';
        const needsLegacyOrderWarning = !payload.exactOrderRecovered
            && (payload.images.length > 0 || payload.removedInternalMarkers);
        if (needsLegacyOrderWarning) {
            warning = payload.removedInternalMarkers
                ? '这条旧消息没有保存原始行内顺序；内部引用标记已移除，附件已保留在正文后，请确认后再重发。'
                : '这条旧消息没有保存完整的行内顺序；未定位的附件已保留在正文后，请确认后再重发。';
        }
        const messageIndex = state.messages.findIndex((item) => item.id === message.id);
        setShowAttachMenu(false);
        setComposerDragKind(null);
        setMessageEditSnapshot({
            parts: payload.parts,
            text: buildChatComposerPlainText(payload.parts),
            referenceCount: payload.parts.filter((part) => part.type === 'reference').length
        });
        setMessageEditError('');
        setMessageEditSession({
            messageId: message.id,
            conversationId,
            projectId,
            projectPath,
            initialParts: payload.parts,
            previewUrls,
            warning,
            truncatesFollowingMessages: messageIndex >= 0 && messageIndex < state.messages.length - 1
        });
    }, [messageEditSession]);

    useLayoutEffect(() => {
        if (!messageEditSession) return;
        messageEditComposerRef.current?.replaceContent(
            messageEditSession.initialParts,
            messageEditSession.previewUrls
        );
        window.requestAnimationFrame(() => messageEditComposerRef.current?.focus());
    }, [messageEditSession?.messageId]);

    const handleMessageEditReferenceRemoved = useCallback((
        reference: ChatComposerReference
    ): void => {
        messageEditRuntimeReferencesRef.current.delete(reference.referenceId);
        if (reference.source.kind !== 'uploaded_image') return;
        const imageId = reference.source.imageId;
        messageEditImagesRef.current = messageEditImagesRef.current.filter((image) => (
            image.id !== imageId
        ));
    }, []);

    const handleMessageEditSnapshotChange = useCallback((
        snapshot: InlineMultimodalComposerSnapshot
    ): void => {
        const activeReferenceIds = new Set<string>();
        const activeImageIds = new Set<string>();
        for (const part of snapshot.parts) {
            if (part.type !== 'reference') continue;
            activeReferenceIds.add(part.reference.referenceId);
            if (part.reference.source.kind === 'uploaded_image') {
                activeImageIds.add(part.reference.source.imageId);
            }
        }
        for (const referenceId of Array.from(messageEditRuntimeReferencesRef.current.keys())) {
            if (!activeReferenceIds.has(referenceId)) {
                messageEditRuntimeReferencesRef.current.delete(referenceId);
            }
        }
        messageEditImagesRef.current = messageEditImagesRef.current.filter((image) => (
            activeImageIds.has(image.id)
        ));
        setMessageEditSnapshot(snapshot);
        setMessageEditError('');
    }, []);

    const handleMessageEditPaste = useCallback((
        event: React.ClipboardEvent<HTMLDivElement>
    ): void => {
        event.preventDefault();
        const plainText = event.clipboardData?.getData('text/plain') || '';
        if (plainText) messageEditComposerRef.current?.insertText(plainText);
        const containsFile = Array.from(event.clipboardData?.items || []).some((item) => (
            item.kind === 'file'
        ));
        if (containsFile) {
            setMessageEditError('编辑已发送消息时暂不新增附件；请先完成编辑，再用新消息补充素材。');
        }
    }, []);

    const handleConfirmMessageEdit = useCallback(async (): Promise<void> => {
        const session = messageEditSession;
        if (!session || messageEditSubmitting) return;
        const snapshot = messageEditComposerRef.current?.getSnapshot() || messageEditSnapshot;
        const parts = normalizeChatComposerContentParts(snapshot.parts);
        if (parts.length === 0) {
            setMessageEditError('消息不能为空。');
            return;
        }

        const imagesById = new Map(messageEditImagesRef.current.map((image) => [image.id, image]));
        const missingImageReference = parts.find((part) => (
            part.type === 'reference'
            && part.reference.source.kind === 'uploaded_image'
            && !imagesById.has(part.reference.source.imageId)
        ));
        if (missingImageReference) {
            setMessageEditError('有一张原附件已无法读取，请移除该引用后再重新发送。');
            return;
        }

        const frozen = buildFrozenComposerSubmission({
            parts,
            images: messageEditImagesRef.current,
            runtimeReferences: messageEditRuntimeReferencesRef.current
        });
        const imageBudgetError = validateFrozenComposerImageBudget(frozen.images);
        if (imageBudgetError) {
            setMessageEditError(imageBudgetError);
            return;
        }

        setMessageEditSubmitting(true);
        setMessageEditError('');
        try {
            const send = handleSendRef.current;
            if (!send) throw new Error('消息发送器尚未就绪，请稍后重试。');
            await send({
                inlineMessageEdit: {
                    messageId: session.messageId,
                    parts: frozen.parts,
                    images: frozen.images,
                    runtimeReferences: new Map(messageEditRuntimeReferencesRef.current)
                },
                expectedConversationId: session.conversationId,
                expectedProjectId: session.projectId,
                expectedProjectPath: session.projectPath
            });
        } catch (error) {
            setMessageEditError(error instanceof Error ? error.message : String(error));
        } finally {
            setMessageEditSubmitting(false);
        }
    }, [messageEditSession, messageEditSnapshot, messageEditSubmitting]);

    // 自动滚动到底部：仅在用户贴底时跟随。长任务流式更新会高频触发这里，
    // 无条件滚底会把正在回看历史的用户反复拽回（护栏判据见 handleMessagesScroll）。
    useEffect(() => {
        if (!stickToBottomRef.current) return;
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // 实时过程块（思考步骤/当前动作/任务卡）不在 messages 里，增长时单独跟随。
    // 用直接置 scrollTop 而不是 smooth：这些更新频率高，叠加平滑动画会抖。
    useEffect(() => {
        if (!stickToBottomRef.current) return;
        const container = messagesContainerRef.current;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
    }, [thinkingSteps, liveActivity, liveTaskCard]);

    // 切换会话后恢复贴底跟随并直接落到最新消息；上一个会话的回看位置不应带过来。
    useEffect(() => {
        stickToBottomRef.current = true;
        setIsPinnedToBottom(true);
        const container = messagesContainerRef.current;
        if (container) container.scrollTop = container.scrollHeight;
    }, [currentConversationId]);

    const handleMessagesScroll = useCallback((): void => {
        const container = messagesContainerRef.current;
        if (!container) return;
        const previousScrollTop = lastMessagesScrollTopRef.current;
        lastMessagesScrollTopRef.current = container.scrollTop;
        const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceToBottom < 80) {
            stickToBottomRef.current = true;
        } else if (container.scrollTop < previousScrollTop) {
            // 只有 scrollTop 实际变小（用户真的向上滚）才解除跟随。
            // 不能按「距底部距离超阈值」判：平滑滚动动画途中、或一条较高的
            // 流式块（图片/任务卡）刚插入时，距离都会瞬时超阈值，误判会让跟随静默失效。
            stickToBottomRef.current = false;
        }
        const pinned = stickToBottomRef.current;
        setIsPinnedToBottom((current) => (current === pinned ? current : pinned));
    }, []);

    const handleScrollToLatest = useCallback((): void => {
        stickToBottomRef.current = true;
        setIsPinnedToBottom(true);
        const container = messagesContainerRef.current;
        if (container) container.scrollTop = container.scrollHeight;
    }, []);

    // 附件菜单的关闭收口与 WorkspaceTabBar 的加页菜单同一标准：
    // 外点关闭 + Esc 关闭 + 打开即聚焦首项。菜单只在打开期间挂全局监听。
    useEffect(() => {
        if (!showAttachMenu) return;
        function handlePointerDown(event: PointerEvent): void {
            if (attachMenuContainerRef.current?.contains(event.target as Node)) return;
            setShowAttachMenu(false);
        }
        function handleEscape(event: KeyboardEvent): void {
            if (event.key === 'Escape') setShowAttachMenu(false);
        }
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleEscape);
        window.requestAnimationFrame(() => firstAttachMenuItemRef.current?.focus());
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [showAttachMenu]);

    const handleApplySuggestion = async (suggestion: TextSuggestion) => {
        if (!window.designEcho) return;
        
        try {
            // 1. 设置文本内容
            await window.designEcho.sendToPlugin('setTextContent', { 
                content: suggestion.text 
            });

            // 2. 设置文本样式 (如果建议中有)
            const styleParams: Record<string, any> = {};
            
            if (suggestion.design.suggestedFontSize) {
                styleParams.fontSize = typeof suggestion.design.suggestedFontSize === 'number' 
                        ? suggestion.design.suggestedFontSize 
                    : parseFloat(suggestion.design.suggestedFontSize as string);
            }

            // 解析字间距（如 "+2%" 转换为 tracking 值）
            if (suggestion.design.suggestedLetterSpacing) {
                const spacing = suggestion.design.suggestedLetterSpacing;
                const match = spacing.match(/([+-]?\d+(?:\.\d+)?)\s*%?/);
                if (match) {
                    // 将百分比转换为 tracking 值（千分之一 em）
                    // 1% ≈ 10 tracking 单位
                    styleParams.tracking = parseFloat(match[1]) * 10;
                }
            }

            // 设置行高
            if (suggestion.design.suggestedLineHeight) {
                // lineHeight 是倍数，需要乘以字号得到 leading 值
                const fontSize = styleParams.fontSize || 12;
                styleParams.leading = suggestion.design.suggestedLineHeight * fontSize;
            }

            if (Object.keys(styleParams).length > 0) {
                await window.designEcho.sendToPlugin('setTextStyle', styleParams);
            }

            addLocalAssistantMessage({
                content: `✅ 已应用方案：${suggestion.text}`
            }, toolSummaryReplyOrigin('layout-suggestion:apply'));

        } catch (error) {
            addLocalAssistantMessage({
                content: formatUserVisibleFailureContent('应用失败', error)
            }, toolSummaryReplyOrigin('layout-suggestion:apply-failed'));
        }
    };

    /**
     * 应用单个排版修复
     */
    const handleApplyLayoutFix = async (fix: LayoutFix): Promise<void> => {
        if (!window.designEcho) return;

        try {
            console.log('[ChatPanel] 应用修复:', fix);
            
            switch (fix.action) {
                case 'move':
                    // 映射 left/top 到 x/y (moveLayer 工具使用 x, y 参数)
                    const moveParams = {
                        layerId: fix.layerId,
                        x: fix.changes.left ?? fix.changes.x ?? 0,
                        y: fix.changes.top ?? fix.changes.y ?? 0,
                        relative: false  // 使用绝对位置
                    };
                    console.log('[ChatPanel] moveLayer 参数:', moveParams);
                    const moveResult = await window.designEcho.sendToPlugin('moveLayer', moveParams);
                    console.log('[ChatPanel] moveLayer 结果:', moveResult);
                    if (!moveResult.success) {
                        throw new Error(moveResult.error || '移动图层失败');
                    }
                    break;
                
                case 'restyle':
                    const restyleResult = await window.designEcho.sendToPlugin('setTextStyle', {
                        layerId: fix.layerId,
                        ...fix.changes
                    });
                    console.log('[ChatPanel] setTextStyle 结果:', restyleResult);
                    if (!restyleResult.success) {
                        throw new Error(restyleResult.error || '设置样式失败');
                    }
                    break;
                
                case 'align':
                    const alignResult = await window.designEcho.sendToPlugin('alignLayers', {
                        layerIds: [fix.layerId],
                        alignType: fix.changes.alignType || 'center'
                    });
                    console.log('[ChatPanel] alignLayers 结果:', alignResult);
                    if (!alignResult.success) {
                        throw new Error(alignResult.error || '对齐失败');
                    }
                    break;
                
                default:
                    console.warn('Unknown fix action:', fix.action);
            }
        } catch (error) {
            console.error('[ChatPanel] 应用修复失败:', error);
            throw new Error(`应用修复失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    };

    /**
     * 批量应用排版修复
     */
    const handleApplyAllLayoutFixes = async (fixes: LayoutFix[]): Promise<void> => {
        for (const fix of fixes) {
            await handleApplyLayoutFix(fix);
        }
        
        addLocalAssistantMessage({
            content: `✅ 已应用 ${fixes.length} 项排版修复`
        }, toolSummaryReplyOrigin('layout-fix:apply-all'));
    };

    const handleOptimize = async () => {
        if (!isPluginConnected) {
            addLocalBlockerMessage('⚠️ 请先连接 Photoshop 插件', 'text-optimize:photoshop-disconnected');
            return;
        }

        setLoading(true);

        try {
            const result = await window.designEcho.sendToPlugin('getTextContent', {});
            if (!result.success) {
                throw new Error(result.error || '获取文本失败');
            }
            const currentText = result.content;

            await window.designEcho.sendToPlugin('getTextStyle', {});

            const aiResponse = await window.designEcho.executeTask('text-optimize', {
                text: currentText
            });

            // 3. 解析结果
            let suggestions: TextSuggestion[] = [];
            if (aiResponse.suggestions) {
                suggestions = aiResponse.suggestions;
            } else {
                // 尝试从文本解析 JSON
                // 实际生产中应该由 TaskOrchestrator 保证返回 JSON
                console.warn('AI response format warning:', aiResponse);
                if (typeof aiResponse === 'string') {
                    // 简单的尝试解析
                    try {
                        const jsonMatch = aiResponse.match(/```json\n?([\s\S]*?)\n?```/);
                        if (jsonMatch) {
                             const parsed = JSON.parse(jsonMatch[1]);
                             if (parsed.suggestions) suggestions = parsed.suggestions;
                        }
                    } catch (e) {
                        console.error('Failed to parse response manually', e);
                    }
                }
            }

            // 4. 展示结果
            if (suggestions.length > 0) {
                addLocalToolSummaryMessage('✨ 优化建议如下：', 'legacy-task:text-optimize', {
                    suggestions: suggestions
                });
            } else {
                addLocalStatusMessage('🤔 AI 未能生成有效建议，请重试。', 'legacy-task:text-optimize:empty');
            }

        } catch (error) {
            console.error('Optimize error:', error);
            addLocalToolSummaryMessage(
                formatUserVisibleFailureContent('优化失败', error),
                'legacy-task:text-optimize:failed'
            );
        } finally {
            setLoading(false);
        }
    };

    const readImageFileIntoComposer = useCallback((
        file: File,
        source: 'chat-paste' | 'chat-upload'
    ): void => {
        if (!isSupportedComposerImageType(file.type)) {
            addLocalBlockerMessage(
                `暂不支持 ${file.type || '未知格式'}。当前可附加 JPEG、PNG、WebP 图片。`,
                'composer:unsupported-image-type'
            );
            return;
        }
        const currentImages = composerImagesRef.current;
        const reservedImageCount = currentImages.length + pendingComposerImageBytesRef.current.size;
        if (reservedImageCount >= MAX_COMPOSER_IMAGES) {
            addLocalBlockerMessage(
                `一次消息最多附加 ${MAX_COMPOSER_IMAGES} 张图片，请移除部分图片后再添加。`,
                'composer:image-limit'
            );
            return;
        }
        if (file.size > MAX_COMPOSER_IMAGE_FILE_BYTES) {
            addLocalBlockerMessage(
                `图片“${file.name || '未命名图片'}”超过 8 MB，请压缩后再添加。`,
                'composer:image-file-too-large'
            );
            return;
        }
        const committedBytes = currentImages.reduce((total, image) => (
            total + estimateBase64PayloadBytes(image.data)
        ), 0);
        const pendingBytes = Array.from(pendingComposerImageBytesRef.current.values())
            .reduce((total, value) => total + value, 0);
        if (committedBytes + pendingBytes + file.size > MAX_COMPOSER_IMAGE_TOTAL_BYTES) {
            addLocalBlockerMessage(
                '本条消息的图片总大小不能超过 20 MB，请移除部分图片后再添加。',
                'composer:image-total-too-large'
            );
            return;
        }

        const imageId = createComposerReferenceId(source);
        const referenceId = createComposerReferenceId('image');
        pendingComposerImageBytesRef.current.set(imageId, file.size);
        setComposerPendingImageCount(pendingComposerImageBytesRef.current.size);
        const reference: ChatComposerReference = {
            version: 'chat-composer-reference/v0',
            referenceId,
            label: file.name || `图片 ${reservedImageCount + 1}`,
            sourceLabel: source === 'chat-paste' ? '剪贴板' : '本地图片',
            mediaKind: 'image',
            source: {
                kind: 'uploaded_image',
                imageId,
                mediaType: file.type as DesignImageInput['mediaType']
            },
            addedAt: new Date().toISOString()
        };
        insertComposerReference(reference, { kind: 'uploaded_image', imageId });

        function releasePendingImage(): void {
            pendingComposerImageBytesRef.current.delete(imageId);
            setComposerPendingImageCount(pendingComposerImageBytesRef.current.size);
        }

        function removeUnreadableReference(message: string, code: string): void {
            releasePendingImage();
            composerRef.current?.removeReference(referenceId);
            addLocalBlockerMessage(message, code);
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            if (!pendingComposerImageBytesRef.current.has(imageId)) return;
            const dataUrl = String(event.target?.result || '');
            const base64Match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i);
            if (!base64Match) {
                removeUnreadableReference(
                    '图片读取失败，未得到可发送的图像数据。',
                    'composer:image-read-failed'
                );
                return;
            }
            const [, mimeType, base64Data] = base64Match;
            const actualBytes = estimateBase64PayloadBytes(base64Data);
            if (actualBytes > MAX_COMPOSER_IMAGE_FILE_BYTES) {
                removeUnreadableReference(
                    `图片“${file.name || '未命名图片'}”超过 8 MB，请压缩后再添加。`,
                    'composer:image-file-too-large'
                );
                return;
            }
            const committedBytesAtRead = composerImagesRef.current.reduce((total, item) => (
                total + estimateBase64PayloadBytes(item.data)
            ), 0);
            const otherPendingBytes = Array.from(pendingComposerImageBytesRef.current.entries())
                .filter(([pendingImageId]) => pendingImageId !== imageId)
                .reduce((total, [, value]) => total + value, 0);
            if (
                committedBytesAtRead
                + otherPendingBytes
                + actualBytes
                > MAX_COMPOSER_IMAGE_TOTAL_BYTES
            ) {
                removeUnreadableReference(
                    '本条消息的图片总大小不能超过 20 MB，请移除部分图片后再添加。',
                    'composer:image-total-too-large'
                );
                return;
            }
            const image = createDesignImageInput({
                id: imageId,
                data: base64Data,
                type: mimeType,
                name: file.name || undefined,
                source
            });
            if (!image) {
                removeUnreadableReference(
                    '图片读取失败，未得到可发送的图像数据。',
                    'composer:image-read-failed'
                );
                return;
            }
            const referenceStillExists = composerRef.current?.getSnapshot().parts.some((part) => (
                part.type === 'reference'
                && part.reference.referenceId === referenceId
            ));
            releasePendingImage();
            if (!referenceStillExists) return;
            const nextImages = [...composerImagesRef.current, image];
            composerImagesRef.current = nextImages;
            setComposerImages(nextImages);
            composerRef.current?.updateReferencePreview(
                referenceId,
                `data:${image.mediaType};base64,${image.data}`
            );
            console.log(
                `[ChatPanel] 已加入行内图片：${file.name || '剪贴板图片'}，${mimeType}，${Math.round(base64Data.length / 1024)}KB`
            );
        };
        reader.onerror = () => {
            if (!pendingComposerImageBytesRef.current.has(imageId)) return;
            removeUnreadableReference(
                '图片读取失败，请重新粘贴或选择文件。',
                'composer:image-read-error'
            );
        };
        reader.readAsDataURL(file);
    }, [insertComposerReference]);

    /** 统一接管粘贴：只接收纯文本，并按剪贴板顺序插入图片占位引用。 */
    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>): void => {
        e.preventDefault();
        const plainText = e.clipboardData?.getData('text/plain') || '';
        if (plainText) composerRef.current?.insertText(plainText);
        const imageItems = Array.from(e.clipboardData?.items || [])
            .filter((item) => item.kind === 'file' && item.type.startsWith('image/'));
        const remaining = Math.max(
            0,
            MAX_COMPOSER_IMAGES
                - composerImagesRef.current.length
                - pendingComposerImageBytesRef.current.size
        );
        for (const item of imageItems.slice(0, remaining)) {
            const file = item.getAsFile();
            if (file) readImageFileIntoComposer(file, 'chat-paste');
        }
    };

    function resolveComposerDragKind(dataTransfer?: DataTransfer | null): 'files' | 'eagle' | null {
        const types = Array.from(dataTransfer?.types || []);
        if (types.includes(EAGLE_COMPOSER_DRAG_MIME)) return 'eagle';
        if (types.includes('Files')) return 'files';
        return null;
    }

    const handleDragEnter = (event: React.DragEvent): void => {
        const dragKind = resolveComposerDragKind(event.dataTransfer);
        if (!dragKind) return;
        event.preventDefault();
        event.stopPropagation();
        if (messageEditSession) {
            setMessageEditError('请先完成当前消息编辑，再向对话添加新素材。');
            return;
        }
        setComposerDragKind(dragKind);
    };

    const handleDragOver = (event: React.DragEvent): void => {
        const dragKind = resolveComposerDragKind(event.dataTransfer);
        if (!dragKind) return;
        event.preventDefault();
        event.stopPropagation();
        if (messageEditSession) return;
        event.dataTransfer.dropEffect = 'copy';
        if (composerDragKind !== dragKind) setComposerDragKind(dragKind);
    };

    /**
     * 处理拖拽离开事件
     */
    const handleDragLeave = (event: React.DragEvent): void => {
        if (!composerDragKind) return;
        event.preventDefault();
        event.stopPropagation();
        
        // 检查是否真的离开了输入区域（而不是进入子元素）
        const rect = inputAreaRef.current?.getBoundingClientRect();
        if (rect) {
            const { clientX, clientY } = event;
            if (
                clientX < rect.left ||
                clientX > rect.right ||
                clientY < rect.top ||
                clientY > rect.bottom
            ) {
                setComposerDragKind(null);
            }
        }
    };

    /**
     * 处理拖拽放置事件 - 支持拖拽图片到输入框
     */
    const handleDrop = (event: React.DragEvent): void => {
        const dragKind = resolveComposerDragKind(event.dataTransfer);
        if (!dragKind) return;
        event.preventDefault();
        event.stopPropagation();
        setComposerDragKind(null);
        if (messageEditSession) {
            setMessageEditError('请先完成当前消息编辑，再向对话添加新素材。');
            return;
        }

        composerRef.current?.moveCaretToPoint(event.clientX, event.clientY);
        if (dragKind === 'eagle') {
            const assetRefs = parseEagleComposerDragPayload(
                event.dataTransfer.getData(EAGLE_COMPOSER_DRAG_MIME)
            );
            if (!assetRefs || assetRefs.length === 0) {
                addLocalBlockerMessage(
                    'Eagle 素材拖拽数据已失效，请重新拖入。',
                    'composer:eagle-drag-invalid'
                );
                return;
            }
            insertEagleAssetRefsIntoComposer(assetRefs);
            composerRef.current?.focus();
            return;
        }

        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const remaining = Math.max(
            0,
            MAX_COMPOSER_IMAGES
                - composerImagesRef.current.length
                - pendingComposerImageBytesRef.current.size
        );
        const imageFiles = Array.from(files)
            .filter((file) => file.type.startsWith('image/'))
            .slice(0, remaining);
        for (const file of imageFiles) {
            readImageFileIntoComposer(file, 'chat-upload');
        }
        composerRef.current?.focus();
    };

    const handleVisualAnalysis = async () => {
        if (!isPluginConnected) {
            addLocalBlockerMessage('⚠️ 请先连接 Photoshop 插件', 'visual-analysis:photoshop-disconnected');
            return;
        }

        if (!referenceImage) {
             addLocalAssistantMessage(
                 { content: '⚠️ 请先上传参考图' },
                 deterministicBlockerReplyOrigin('visual-analysis:missing-reference-image')
             );
             return;
        }

        setLoading(true);
        addLocalAssistantMessage(
            { content: '🔍 正在获取当前画布截图...' },
            uiStatusReplyOrigin('visual-analysis:capture-started')
        );

        try {
            // 1. 获取当前画布截图
            const snapshotResult = await window.designEcho.sendToPlugin('getDocumentSnapshot', {
                maxWidth: 800,
                maxHeight: 600,
                format: 'jpeg'
            });

            if (!snapshotResult.success) {
                throw new Error(snapshotResult.error || '获取画布截图失败');
            }

            addLocalAssistantMessage(
                { content: '🤖 正在进行视觉对比分析...' },
                uiStatusReplyOrigin('visual-analysis:model-started')
            );

            // 2. 调用 AI 视觉对比
            const aiResponse = await window.designEcho.executeTask('visual-compare', {
                image: {
                    data: referenceImage, // Base64
                    mediaType: 'image/jpeg' 
                },
                documentImage: {
                    data: snapshotResult.imageData,
                    mediaType: 'image/jpeg'
                }
            });

            // 3. 解析并展示结果。legacy 通道只展示可读摘要，结构化原文保留在内部结果中。
            let content = '分析完成。\n\n';
            
            if (aiResponse.differences) {
                content += '**视觉差异：**\n';
                aiResponse.differences.forEach((diff: any) => {
                    const dimension = sanitizeUserVisibleDiagnosticText(diff?.dimension || '项目');
                    const description = sanitizeUserVisibleAssistantBodyText(diff?.description)
                        || sanitizeUserVisibleDiagnosticText(diff?.description);
                    if (description) {
                        content += `- ${dimension}: ${description}\n`;
                    }
                });
            }

            if (aiResponse.suggestions) {
                content += '\n**改进建议：**\n';
                aiResponse.suggestions.forEach((sugg: any) => {
                    const target = sanitizeUserVisibleDiagnosticText(sugg?.target || '画面');
                    const action = sanitizeUserVisibleAssistantBodyText(sugg?.action)
                        || sanitizeUserVisibleDiagnosticText(sugg?.action);
                    const reason = sanitizeUserVisibleAssistantBodyText(sugg?.reason)
                        || sanitizeUserVisibleDiagnosticText(sugg?.reason);
                    if (action) {
                        content += `- ${target}: ${action}${reason ? `（${reason}）` : ''}\n`;
                    }
                });
            }

            if (aiResponse.summary) {
                const summary = sanitizeUserVisibleAssistantBodyText(aiResponse.summary)
                    || sanitizeUserVisibleDiagnosticText(aiResponse.summary);
                if (summary) {
                    content += `\n**总结**：${summary}`;
                }
            }

            // 如果没有结构化数据，只允许展示字符串摘要，不展示对象原始 JSON。
            if (!aiResponse.differences && !aiResponse.suggestions) {
                const textSummary = typeof aiResponse === 'string'
                    ? (sanitizeUserVisibleAssistantBodyText(aiResponse) || sanitizeUserVisibleDiagnosticText(aiResponse))
                    : '';
                content += textSummary || '这次分析没有返回可展示的摘要。';
            }

            addLocalAssistantMessage({
                content: content
            }, toolSummaryReplyOrigin('legacy-task:visual-compare'));

        } catch (error) {
             addLocalAssistantMessage({
                content: formatUserVisibleFailureContent('分析失败', error)
            }, toolSummaryReplyOrigin('legacy-task:visual-compare:failed'));
        } finally {
            setLoading(false);
        }
    };

    const handleImageUpload = (file: File, base64: string) => {
        addComposerImage({
            data: base64,
            type: file.type,
            name: file.name,
            source: 'chat-upload',
            originalBytes: file.size
        });
        setShowUpload(false);
        composerRef.current?.focus();
    };

    const captureScreenshotForChat = async (source: 'agent' | 'desktop') => {
        try {
            const captureResult = source === 'agent'
                ? await window.designEcho.captureAgentWindowScreenshot?.()
                : await window.designEcho.captureDesktopScreenshot?.();

            if (!captureResult?.success || !captureResult.imageBase64) {
                addLocalAssistantMessage({
                    content: formatUserVisibleFailureContent('截图失败', captureResult?.error, '接口不可用')
                }, toolSummaryReplyOrigin(`screenshot:${source}:failed`));
                return;
            }

            addComposerImage({
                data: captureResult.imageBase64,
                type: captureResult.mimeType || 'image/png',
                name: source === 'agent' ? 'Agent 窗口截图' : '桌面截图',
                source: 'chat-upload'
            });
            setShowAttachMenu(false);
            composerRef.current?.focus();
        } catch (error: any) {
            addLocalAssistantMessage({
                content: formatUserVisibleFailureContent('截图失败', error)
            }, toolSummaryReplyOrigin(`screenshot:${source}:error`));
        }
    };
    
    /**
     * 统一的消息发送处理
     * 
     * 设计原则：
     * 1. 所有对话都交给 AI Agent 处理，保证上下文理解
     * 2. AI 可以调用工具执行操作
     * 3. 只有明确的斜杠命令才特殊处理
     */
    const handleSend = async (override?: ChatSendOverride) => {
        const hasOverride = typeof override !== 'undefined';
        const inlineMessageEdit = hasOverride ? override?.inlineMessageEdit : undefined;
        if (!hasOverride && pendingComposerImageBytesRef.current.size > 0) {
            addLocalBlockerMessage(
                '图片仍在解析，请等待缩略图显示后再发送。',
                'composer:image-still-loading'
            );
            return;
        }
        const interactiveContinuationRequest = hasOverride
            ? override?.interactiveContinuationRequest
            : undefined;
        const internalResumeRequest = hasOverride
            ? override?.internalResumeRequest
            : undefined;
        const overrideImage = hasOverride && !inlineMessageEdit && override?.image
            ? createDesignImageInput({
                data: override.image.data,
                type: override.image.type,
                source: 'unknown'
            })
            : null;
        const overrideParts: ChatComposerContentPart[] = inlineMessageEdit
            ? normalizeChatComposerContentParts(inlineMessageEdit.parts).map((part) => (
                part.type === 'text'
                    ? { type: 'text' as const, text: part.text }
                    : {
                        type: 'reference' as const,
                        reference: cloneChatComposerReference(part.reference)
                    }
            ))
            : [];
        if (overrideImage) {
            overrideParts.push({
                type: 'reference',
                reference: {
                    version: 'chat-composer-reference/v0',
                    referenceId: createComposerReferenceId('image'),
                    label: overrideImage.name || '附件图片',
                    sourceLabel: '图片附件',
                    mediaKind: 'image',
                    source: {
                        kind: 'uploaded_image',
                        imageId: overrideImage.id,
                        mediaType: overrideImage.mediaType
                    },
                    addedAt: new Date().toISOString()
                }
            });
        }
        if (!inlineMessageEdit && override?.text) {
            overrideParts.push({ type: 'text', text: override.text });
        }
        const composerState = hasOverride
            ? {
                parts: overrideParts,
                text: buildChatComposerPlainText(overrideParts),
                referenceCount: overrideParts.filter((part) => part.type === 'reference').length
            }
            : (composerRef.current?.getSnapshot() || composerSnapshot);
        const plainInput = buildChatComposerPlainText(composerState.parts);
        const orderedModelInput = buildChatComposerModelText(composerState.parts);
        let submissionImages = composerImagesRef.current.map((image) => ({ ...image }));
        if (hasOverride) {
            if (inlineMessageEdit) {
                submissionImages = inlineMessageEdit.images.map((image) => ({ ...image }));
            } else {
                submissionImages = overrideImage ? [overrideImage] : [];
            }
        }
        let runtimeReferences: ReadonlyMap<string, ComposerRuntimeReference> =
            composerRuntimeReferencesRef.current;
        if (inlineMessageEdit) {
            runtimeReferences = inlineMessageEdit.runtimeReferences;
        } else if (hasOverride) {
            runtimeReferences = new Map<string, ComposerRuntimeReference>();
        }
        const frozenSubmission = buildFrozenComposerSubmission({
            parts: composerState.parts,
            images: submissionImages,
            runtimeReferences
        });
        const frozenImageBudgetError = validateFrozenComposerImageBudget(frozenSubmission.images);
        if (frozenImageBudgetError) {
            if (hasOverride) throw new Error(frozenImageBudgetError);
            addLocalBlockerMessage(frozenImageBudgetError, 'composer:image-budget-exceeded');
            return;
        }
        const hasUserInstruction = Boolean(plainInput);
        const hasStructuredMessageContent = frozenSubmission.parts.length > 0;
        if (!hasStructuredMessageContent && !interactiveContinuationRequest && !internalResumeRequest) {
            if (inlineMessageEdit) throw new Error('消息不能为空。');
            return;
        }
        const stateAtSend = useAppStore.getState();
        if (chatSubmissionInFlightRef.current || stateAtSend.isLoading) {
            if (hasOverride) {
                throw new Error('当前已有设计任务正在执行，请等待完成或先停止当前任务。');
            }
            return;
        }
        const expectedConversationId = String(override?.expectedConversationId || '').trim();
        const expectedProjectId = String(override?.expectedProjectId || '').trim();
        const expectedProjectPath = String(override?.expectedProjectPath || '').trim();
        if (expectedConversationId && expectedConversationId !== String(stateAtSend.currentConversationId || '').trim()) {
            throw new Error('确认卡所属对话已经切换，本轮不会启动。请返回原对话后再次确认。');
        }
        if (expectedProjectId && expectedProjectId !== String(stateAtSend.currentProject?.id || '').trim()) {
            throw new Error('确认卡所属项目已经切换，本轮不会启动。请返回原项目后再次确认。');
        }
        if (
            expectedProjectPath
            && expectedProjectPath.toLowerCase() !== String(stateAtSend.currentProject?.path || '').trim().toLowerCase()
        ) {
            throw new Error('确认卡所属项目目录已经变化，本轮不会启动。请返回原项目后再次确认。');
        }

        const submissionToken = `chat-submit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        chatSubmissionInFlightRef.current = submissionToken;
        try {
        const runConversationId = expectedConversationId || stateAtSend.currentConversationId;
        if (!runConversationId) {
            throw new Error('当前没有可写入的对话，请新建对话后重试。');
        }
        let userInput = orderedModelInput;
        if (!hasUserInstruction && submissionImages.length > 0) {
            userInput = [orderedModelInput, '请结合这些图片处理我的当前请求。']
                .filter(Boolean)
                .join('\n');
        }
        const providerNativeWebSearchIntent = interactiveContinuationRequest || internalResumeRequest
            ? undefined
            : resolveChatWebSearchIntent({ userInput });
        
        if (!interactiveContinuationRequest && !internalResumeRequest && (userInput || submissionImages.length > 0)) {
            if (inlineMessageEdit) {
                const didReplace = replaceUserMessageAndTruncate(
                    runConversationId,
                    inlineMessageEdit.messageId,
                    {
                        content: userInput,
                        contentParts: frozenSubmission.parts,
                        images: toChatMessageImages(frozenSubmission.images)
                    }
                );
                if (!didReplace) {
                    throw new Error('原消息或所属对话已经变化，未保存本次编辑。请重新打开消息后再试。');
                }
                resetMessageEditSession(false);
            } else {
                addMessage({
                    role: 'user',
                    content: userInput,
                    contentParts: frozenSubmission.parts,
                    images: toChatMessageImages(frozenSubmission.images)
                });
            }
            if (!hasOverride) {
                setInput('');
                setReferenceImage(null);
                composerImagesRef.current = [];
                setComposerImages([]);
                pendingComposerImageBytesRef.current.clear();
                setComposerPendingImageCount(0);
                composerRuntimeReferencesRef.current.clear();
                composerRef.current?.clear();
            }
        }

        const guardedDebugRequestId = String(
            override?.guardedPhotoshopExecutionBaseline?.requestId || ''
        ).trim();
        if (guardedDebugRequestId
            && cancelledDebugBridgeRequestIdsRef.current.has(guardedDebugRequestId)) {
            throw new Error('受控调试请求已取消，本轮不会继续提交模型或 Photoshop 写入。');
        }

        // 受控 Debug 请求不走本地快捷路径：该路径无法携带请求级 Photoshop
        // baseline，也无法由 Agent AbortController 在超时后中断。
        // 只有斜杠命令特殊处理
        if (!guardedDebugRequestId
            && !interactiveContinuationRequest
            && !internalResumeRequest
            && userInput.startsWith('/')) {
            handleCommand(userInput);
            return;
        }

        // ======== 快捷命令模式：对于常见操作直接执行，不调用 AI ========
        if (!guardedDebugRequestId && !interactiveContinuationRequest && !internalResumeRequest) {
            const quickResult = await tryQuickCommand(userInput);
            if (quickResult.handled) {
                // 快捷命令已处理
                addLocalAssistantMessage(
                    { content: quickResult.message || '' },
                    toolSummaryReplyOrigin('quick-command:result')
                );
                return;
            }
        }

        // 所有其他对话都交给 AI Agent 处理
        const runId = `agent-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setLoading(true);
        try {
            if (guardedDebugRequestId
                && cancelledDebugBridgeRequestIdsRef.current.has(guardedDebugRequestId)) {
                throw new Error('受控调试请求已取消，本轮不会继续提交模型或 Photoshop 写入。');
            }
            await handleUnifiedAgent(userInput, frozenSubmission.images, {
                runId,
                conversationId: runConversationId,
                submission: frozenSubmission,
                publicPlanConfirmationSourceMessageId: hasOverride
                    ? override?.publicPlanConfirmationSourceMessageId
                    : undefined,
                publicPlanConfirmationRequestId: hasOverride
                    ? override?.publicPlanConfirmationRequestId
                    : undefined,
                publicPlanDisposableLiveAdapter: hasOverride
                    ? override?.publicPlanDisposableLiveAdapter
                    : undefined,
                guardedPhotoshopExecutionBaseline: hasOverride
                    ? override?.guardedPhotoshopExecutionBaseline
                    : undefined,
                interactiveContinuationRequest,
                internalResumeRequest,
                providerNativeWebSearchIntent
            });
        } catch (error) {
            console.error('Agent error:', error);
            if (activeAgentRunIdRef.current === runId) {
                addLocalAssistantMessage({
                    content: formatUserVisibleFailureContent('处理失败', error)
                }, uiStatusReplyOrigin('agent-run:outer-error'), { conversationId: runConversationId });
            }
        } finally {
            if (activeAgentRunIdRef.current === runId) {
                setLoading(false);
                activeAgentRunIdRef.current = null;
                if (activeAgentRunUiRef.current?.runId === runId) {
                    activeAgentRunUiRef.current = null;
                }
                cancelledAgentRunIdsRef.current.delete(runId);
                setAbortController(null);
            } else {
                cancelledAgentRunIdsRef.current.delete(runId);
            }
        }
        } finally {
            // 只释放自己占用的那一轮：用户停止后可能已经发起了新提交，无条件置空会把新一轮的
            // 重入保护一起清掉。
            if (chatSubmissionInFlightRef.current === submissionToken) {
                chatSubmissionInFlightRef.current = null;
            }
        }
    };

    handleSendRef.current = handleSend;

    const buildChatTestSnapshot = useCallback(() => {
        const state = useAppStore.getState();
        return {
            isLoading: state.isLoading,
            messageCount: state.messages.length,
            messages: state.messages.map((message) => {
                const converted = convertLegacyMessage(message as any);
                const thinkingBlockTitles = converted.blocks
                    .filter((block: any) => block.type === 'thinking')
                    .map((block: any) => String(block.title || '').trim())
                    .filter(Boolean);
                const cardBlocks = converted.blocks.filter((block: any) => block.type === 'card');
                const cardTitles = cardBlocks
                    .map((block: any) => String(block.title || '').trim())
                    .filter(Boolean);
                const cardVariants = cardBlocks
                    .map((block: any) => String(block.variant || '').trim())
                    .filter(Boolean);
                const businessPreflightCardTitles = cardTitles
                    .filter((title) => title.includes('处理前先确认'));
                const agentDiagnosticRecord = (message as any).agentDiagnosticRecord;
                const modelMediatedUserReplyUnavailable =
                    agentDiagnosticRecord?.modelMediatedUserReplyUnavailable
                    && typeof agentDiagnosticRecord.modelMediatedUserReplyUnavailable === 'object'
                        ? agentDiagnosticRecord.modelMediatedUserReplyUnavailable as Record<string, unknown>
                        : undefined;
                const businessVisualObservationFeedback = (message as any).businessVisualObservationFeedback;
                const conversationalModelFailure = (message as any).conversationalModelFailure;
                const publicPlanExecutionRequest = (message as any).agentTaskPublicPlanExecutionRequest;
                const publicPlanControlledRun = (message as any).agentTaskPublicPlanControlledRun;
                const conversationalFailureAttempts = Array.isArray(conversationalModelFailure?.attempts)
                    ? conversationalModelFailure.attempts
                        .map((attempt: any) => ({
                            purpose: sanitizeTestSnapshotToken(attempt?.purpose),
                            status: sanitizeTestSnapshotToken(attempt?.status),
                            errorKind: sanitizeTestSnapshotToken(attempt?.errorKind),
                            reason: sanitizeTestSnapshotToken(attempt?.reason)
                        }))
                        .filter((attempt: any) => attempt.purpose || attempt.status || attempt.errorKind)
                        .slice(0, 4)
                    : [];
                const visibleTextPreview = collectChatSnapshotVisibleStrings(converted.blocks)
                    .join('\n')
                    .slice(0, 2500);
                return {
                    id: message.id,
                    role: message.role,
                    assistantReplyOrigin: message.assistantReplyOrigin,
                    contentPreview: typeof message.content === 'string'
                        ? sanitizeTestSnapshotPreview(message.content).slice(0, 1000)
                        : '',
                    visibleTextPreview,
                    hasImage: !!message.image,
                    thinkingStepCount: Array.isArray(message.thinkingSteps) ? message.thinkingSteps.length : 0,
                    thinkingPreview: Array.isArray(message.thinkingSteps)
                        ? message.thinkingSteps
                            .map(step => formatTestSnapshotThinkingStep(step))
                            .join('\n')
                            .slice(0, 1500)
                        : '',
                    thinkingBlockTitles,
                    cardTitles,
                    cardVariants,
                    taskPlanPresentation: summarizeChatTestTaskPlan((message as any).agentTaskPlanPresentation),
                    toolResults: summarizeChatTestToolResults(message.thinkingSteps),
                    agentUserVisibleState: resolveChatSnapshotAgentUserVisibleState(message),
                    agentDiagnosticRecordKeys: Array.isArray(agentDiagnosticRecord?.recordKeys)
                        ? agentDiagnosticRecord.recordKeys
                            .map((key: unknown) => sanitizeTestSnapshotToken(key))
                            .filter(Boolean)
                        : [],
                    modelMediatedUserReplyUnavailable: modelMediatedUserReplyUnavailable
                        ? {
                            reason: sanitizeTestSnapshotToken(modelMediatedUserReplyUnavailable.reason),
                            rawResponseShape: sanitizeTestSnapshotPreview(modelMediatedUserReplyUnavailable.rawResponseShape),
                            rawTextPreview: sanitizeTestSnapshotPreview(modelMediatedUserReplyUnavailable.rawTextPreview),
                            sanitizedTextPreview: sanitizeTestSnapshotPreview(modelMediatedUserReplyUnavailable.sanitizedTextPreview),
                            errorPreview: sanitizeTestSnapshotPreview(modelMediatedUserReplyUnavailable.errorPreview)
                        }
                        : undefined,
                    businessPreflightCardTitles,
                    businessPreflightCardCount: businessPreflightCardTitles.length,
                    hasBusinessVisualObservationFeedback: !!businessVisualObservationFeedback,
                    businessVisualObservationFeedbackUserVisible: businessVisualObservationFeedback?.userVisible === true,
                    businessVisualObservationFeedbackSeverity: sanitizeTestSnapshotPreview(businessVisualObservationFeedback?.severity),
                    hasPublicPlanExecutionRequest: !!publicPlanExecutionRequest,
                    publicPlanRawStatus: sanitizeTestSnapshotToken(publicPlanExecutionRequest?.status),
                    publicPlanRequestStatus: sanitizeTestSnapshotPreview(publicPlanExecutionRequest?.status),
                    publicPlanProposedWriteTools: Array.isArray(publicPlanExecutionRequest?.proposedWriteTools)
                        ? publicPlanExecutionRequest.proposedWriteTools.map((toolName: unknown) => sanitizeTestSnapshotToken(toolName)).filter(Boolean)
                        : [],
                    publicPlanAllowedWriteTools: Array.isArray(publicPlanExecutionRequest?.allowedWriteTools)
                        ? publicPlanExecutionRequest.allowedWriteTools.map((toolName: unknown) => sanitizeTestSnapshotToken(toolName)).filter(Boolean)
                        : [],
                    publicPlanReadbackTargets: Array.isArray(publicPlanExecutionRequest?.readbackTargets)
                        ? publicPlanExecutionRequest.readbackTargets.map((target: unknown) => sanitizeTestSnapshotToken(target)).filter(Boolean)
                        : [],
                    publicPlanOperationCount: Array.isArray(publicPlanExecutionRequest?.operationRequests)
                        ? publicPlanExecutionRequest.operationRequests.length
                        : 0,
                    publicPlanApprovalStatus: sanitizeTestSnapshotPreview((message as any).agentTaskPublicPlanApprovalRecord?.status),
                    hasPublicPlanControlledRun: !!publicPlanControlledRun,
                    publicPlanControlledRunStatus: sanitizeTestSnapshotPreview(publicPlanControlledRun?.status),
                    publicPlanControlledRunBlockers: Array.isArray(publicPlanControlledRun?.blockers)
                        ? publicPlanControlledRun.blockers.map((blocker: unknown) => sanitizeTestSnapshotPreview(blocker)).filter(Boolean)
                        : [],
                    publicPlanControlledRunOperationResults: summarizePublicPlanControlledRunOperationResults(publicPlanControlledRun),
                    toolResultCount: Array.isArray(message.thinkingSteps)
                        ? message.thinkingSteps.filter(step => !!(step as any).toolResult).length
                        : 0,
                    executionStatus: sanitizeTestSnapshotToken((message.executionSummary as any)?.status),
                    executionSummaryPreview: typeof (message.executionSummary as any)?.summaryText === 'string'
                        ? sanitizeTestSnapshotPreview((message.executionSummary as any).summaryText).slice(0, 1000)
                        : '',
                    conversationalFailureKind: sanitizeTestSnapshotToken(conversationalModelFailure?.kind),
                    conversationalFailureAttempts
                };
            })
        };
    }, []);

    const waitForChatIdle = useCallback(async (timeoutMs = 30000) => {
        const started = Date.now();
        while (useAppStore.getState().isLoading) {
            if (Date.now() - started > timeoutMs) {
                throw new Error(`ChatPanel test bridge timed out after ${timeoutMs}ms`);
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return buildChatTestSnapshot();
    }, [buildChatTestSnapshot]);

    const waitForChatRunStartOrAssistant = useCallback(async (beforeMessageCount: number, timeoutMs = 5000) => {
        const started = Date.now();
        while (Date.now() - started <= timeoutMs) {
            const state = useAppStore.getState();
            const newMessages = state.messages.slice(beforeMessageCount);
            if (state.isLoading || newMessages.some(message => message.role === 'assistant')) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }, []);

    const resetChatTestConversation = useCallback(() => {
        const state = useAppStore.getState();
        if (state.isLoading) {
            throw new Error('Cannot reset the ChatPanel test conversation while a request is running.');
        }
        state.createConversation();
        return buildChatTestSnapshot();
    }, [buildChatTestSnapshot]);

    useEffect(() => {
        // 编译期常量是测试桥的唯一生产边界；生产构建会连同动态模块一起移除。
        if (process.env.NODE_ENV !== 'development') return;
        const enabled = new URLSearchParams(window.location.search || '')
            .get('designechoChatTestBridge') === '1';
        if (!enabled) return;

        let disposed = false;
        let uninstall: (() => void) | undefined;
        void import('../testing/chat-panel-test-bridge').then((testBridge) => {
            if (disposed) return;
            uninstall = testBridge.installChatPanelTestBridge({
                version: 1,
                submit: async (text: string, options?: { image?: { data: string; type: string }; timeoutMs?: number; publicPlanConfirmationSourceMessageId?: string; publicPlanConfirmationRequestId?: string; publicPlanDisposableLiveAdapter?: boolean }) => {
                    if (chatSubmissionInFlightRef.current || useAppStore.getState().isLoading) {
                        throw new Error('当前已有设计任务正在执行，请等待完成或先停止当前任务。');
                    }
                    const before = buildChatTestSnapshot();
                    const sendPromise = handleSend({
                        text,
                        image: options?.image || null,
                        publicPlanConfirmationSourceMessageId: options?.publicPlanConfirmationSourceMessageId,
                        publicPlanConfirmationRequestId: options?.publicPlanConfirmationRequestId,
                        publicPlanDisposableLiveAdapter: options?.publicPlanDisposableLiveAdapter
                    });
                    void sendPromise.catch(error => {
                        console.warn('[ChatPanelTestBridge] submit send failed:', error);
                    });
                    await waitForChatRunStartOrAssistant(before.messageCount, Math.min(options?.timeoutMs || 30000, 5000));
                    return waitForChatIdle(options?.timeoutMs);
                },
                getSnapshot: buildChatTestSnapshot,
                resetConversation: resetChatTestConversation,
                waitForIdle: waitForChatIdle,
                getLatestAcceptanceDebug: (acceptanceCase, options) => {
                    const state = useAppStore.getState();
                    const assistantMessages = state.messages.filter((message) => message.role === 'assistant');
                    const targetMessage = options?.messageId
                        ? assistantMessages.find((message) => message.id === options.messageId)
                        : assistantMessages[assistantMessages.length - 1];
                    if (!targetMessage) {
                        throw new Error('No assistant message is available for acceptance debug export.');
                    }
                    return testBridge.buildChatPanelAcceptanceDebug({
                        acceptanceCase,
                        message: {
                            content: targetMessage.content,
                            agentRequestLifecycle: targetMessage.agentRequestLifecycle,
                            executionSummary: targetMessage.executionSummary,
                            agentDiagnosticRecord: targetMessage.agentDiagnosticRecord,
                            thinkingSteps: targetMessage.thinkingSteps
                        }
                    });
                }
            });
        });

        return () => {
            disposed = true;
            uninstall?.();
        };
    }, [buildChatTestSnapshot, handleSend, resetChatTestConversation, waitForChatIdle, waitForChatRunStartOrAssistant]);

    useEffect(() => {
        const unsubscribe = window.designEcho?.onDebugBridgeChatPreflight?.(() => {
            const state = useAppStore.getState();
            const selectedModelId = String(state.modelPreferences?.primaryModel || '').trim();
            const selectedModel = getModelById(selectedModelId);
            return {
                version: DEBUG_BRIDGE_CHAT_PREFLIGHT_VERSION,
                capturedAt: new Date().toISOString(),
                selectedProvider: String(selectedModel?.provider || '').trim(),
                selectedModelId,
                selectedApiModelId: String(selectedModel?.apiModelId || '').trim(),
                selectedModelResolved: Boolean(selectedModel),
                projectPath: String(state.currentProject?.path || '').trim(),
                chatBusy: Boolean(chatSubmissionInFlightRef.current || state.isLoading)
            };
        });
        return () => {
            unsubscribe?.();
        };
    }, []);

    useEffect(() => {
        const unsubscribe = window.designEcho?.onDebugBridgeChatCancel?.((request) => {
            const requestId = String(request?.requestId || '').trim();
            if (!requestId || activeDebugBridgeRequestIdRef.current !== requestId) return;
            // Cancel 可能早于 handleSend/AbortController 到达（例如仍在 diagnoseState/listDocuments
            // 写前预检）。请求级账本保证预检返回后也不能晚启动模型或 Photoshop 写入。
            cancelledDebugBridgeRequestIdsRef.current.add(requestId);
            stopGeneration();
            markActiveAgentRunStopped();
        });
        return () => {
            unsubscribe?.();
        };
    }, [stopGeneration]);

    useEffect(() => {
        const unsubscribe = window.designEcho?.onDebugBridgeChatSubmit?.(async (request) => {
            let executionStage: DebugBridgeChatExecutionStage = 'renderer_preflight';
            let writePossible = false;
            const text = String(request?.text || '').trim();
            const debugRequestId = String(request?.requestId || '').trim();
            try {
                if (!text) {
                    throw new Error('Debug Bridge chat submit requires text.');
                }
                if (!debugRequestId) {
                    throw new Error('Debug Bridge chat submit requires request identity.');
                }
                if (chatSubmissionInFlightRef.current || useAppStore.getState().isLoading) {
                    throw new Error('当前已有设计任务正在执行，请等待完成或先停止当前任务。');
                }
                if (activeDebugBridgeRequestIdRef.current) {
                    throw new Error('已有受控调试请求尚未闭合，本轮不会启动。');
                }
                activeDebugBridgeRequestIdRef.current = debugRequestId;
                cancelledDebugBridgeRequestIdsRef.current.delete(debugRequestId);
                executionStage = 'before_handle_send';
                const throwIfDebugRequestCancelled = (): void => {
                    if (cancelledDebugBridgeRequestIdsRef.current.has(debugRequestId)) {
                        throw new Error('受控调试请求已取消，本轮不会继续提交模型或 Photoshop 写入。');
                    }
                };
                const expectedProjectPath = String(request?.expectedProjectPath || '')
                    .trim()
                    .replace(/\\/g, '/')
                    .replace(/\/+$/, '')
                    .toLowerCase();
                const currentProjectPath = String(useAppStore.getState().currentProject?.path || '')
                    .trim()
                    .replace(/\\/g, '/')
                    .replace(/\/+$/, '')
                    .toLowerCase();
                if (expectedProjectPath) {
                    if (!currentProjectPath || currentProjectPath !== expectedProjectPath) {
                        throw new Error('当前项目与受控调试指定目录不一致，已在提交模型和 Photoshop 写入前停止。');
                    }
                }
                const expectedProvider = String(request?.expectedProvider || '').trim();
                const expectedModelId = String(request?.expectedModelId || '').trim();
                const expectedPhotoshopRuntimeBuildId = String(
                    request?.expectedPhotoshopRuntimeBuildId || ''
                ).trim();
                const expectedPhotoshopRuntimeBinding = readDebugBridgePhotoshopRuntimeBinding(
                    request?.expectedPhotoshopRuntimeBinding
                );
                if (!expectedPhotoshopRuntimeBuildId
                    || !expectedPhotoshopRuntimeBinding
                    || expectedPhotoshopRuntimeBinding.live.buildId !== expectedPhotoshopRuntimeBuildId) {
                    throw new Error('受控调试缺少完整 Photoshop Runtime 身份，本轮不会提交。');
                }
                const selectedState = useAppStore.getState();
                const selectedModelId = String(selectedState.modelPreferences?.primaryModel || '').trim();
                const selectedModel = getModelById(selectedModelId);
                const selectedApiModelId = String(selectedModel?.apiModelId || '').trim();
                const selectedProvider = String(selectedModel?.provider || '').trim();
                if (expectedModelId && expectedModelId !== selectedModelId && expectedModelId !== selectedApiModelId) {
                    throw new Error(`当前选择的模型不是受控调试指定模型 ${expectedModelId}，本轮不会提交。`);
                }
                if (expectedProvider && expectedProvider !== selectedProvider) {
                    throw new Error(`当前选择的 Provider 不是受控调试指定 Provider ${expectedProvider}，本轮不会提交。`);
                }
                const submittedPhotoshopRuntimeResult = await executeToolCall('diagnoseState', {
                    verbose: false
                });
                throwIfDebugRequestCancelled();
                const submittedPhotoshopRuntimeIdentity = readDebugPhotoshopRuntimeIdentity(
                    submittedPhotoshopRuntimeResult
                );
                const submittedPhotoshopRuntimeBuildId = submittedPhotoshopRuntimeIdentity?.buildId || '';
                if (!submittedPhotoshopRuntimeIdentity
                    || !debugBridgePhotoshopRuntimeLiveIdentitiesMatch(
                        submittedPhotoshopRuntimeIdentity,
                        expectedPhotoshopRuntimeBinding.live
                    )) {
                    throw new Error(
                        `当前 Photoshop Runtime 完整身份与受控调试指定版本不一致（期望 ${expectedPhotoshopRuntimeBuildId}，实际 ${submittedPhotoshopRuntimeBuildId || 'unknown'}）。`
                    );
                }
                let openPhotoshopDocumentCountAtSubmission: number | null = null;
                if (request.requireNoOpenPhotoshopDocuments === true) {
                    const documentListResult = await executeToolCall('listDocuments', {
                        includeDetails: false
                    });
                    throwIfDebugRequestCancelled();
                    if (documentListResult?.success !== true
                        || !Array.isArray(documentListResult?.documents)) {
                        throw new Error('无法可靠读取 Photoshop 文档列表，本轮受控调试不会提交模型或执行写入。');
                    }
                    const openDocumentCount = documentListResult.documents.length;
                    openPhotoshopDocumentCountAtSubmission = openDocumentCount;
                    if (openDocumentCount > 0) {
                        throw new Error(`Photoshop 当前仍打开 ${openDocumentCount} 个既有文档；请先安全处理这些文档，再运行隔离测试。`);
                    }
                }
                const guardedPhotoshopExecutionBaseline = createGuardedPhotoshopExecutionBaseline({
                    requestId: debugRequestId,
                    expectedPhotoshopRuntimeBuildId,
                    expectedPhotoshopRuntimeBinding
                });
                if (request.resetConversation) {
                    resetChatTestConversation();
                }
                const submitAndWait = async () => {
                    throwIfDebugRequestCancelled();
                    const submittedState = useAppStore.getState();
                    const submittedModelId = String(submittedState.modelPreferences?.primaryModel || '').trim();
                    const submittedModel = getModelById(submittedModelId);
                    const submittedApiModelId = String(submittedModel?.apiModelId || '').trim();
                    const submittedProvider = String(submittedModel?.provider || '').trim();
                    if (expectedModelId
                        && expectedModelId !== submittedModelId
                        && expectedModelId !== submittedApiModelId) {
                        throw new Error(`提交前模型已变化，不再启动本轮受控调试（期望 ${expectedModelId}）。`);
                    }
                    if (expectedProvider && expectedProvider !== submittedProvider) {
                        throw new Error(`提交前 Provider 已变化，不再启动本轮受控调试（期望 ${expectedProvider}）。`);
                    }
                    // 这是进入 handleSend 前最后一个同步检查。检查与函数调用之间没有 await，
                    // 后续一旦让出事件循环，handleSend 已建立本轮 AbortController，取消会正常中断。
                    throwIfDebugRequestCancelled();
                    beginDebugFinalArtifactCapture(debugRequestId);
                    executionStage = 'handle_send_started';
                    writePossible = true;
                    await handleSend({
                        text,
                        image: null,
                        expectedProjectPath: request.expectedProjectPath,
                        guardedPhotoshopExecutionBaseline,
                        publicPlanConfirmationSourceMessageId: request.publicPlanConfirmationSourceMessageId,
                        publicPlanConfirmationRequestId: request.publicPlanConfirmationRequestId,
                        publicPlanDisposableLiveAdapter: request.publicPlanDisposableLiveAdapter
                    });
                    executionStage = 'completion';
                    const finalArtifactRefs = normalizeDebugFinalArtifactRefs(
                        readDebugFinalArtifactPaths(debugRequestId),
                        request.expectedProjectPath
                    );
                    const skuDeliveryEvidence = normalizeDebugSkuDeliveryEvidence(
                        readDebugSkuDeliverySource(debugRequestId),
                        request.expectedProjectPath
                    );
                    const snapshot = buildChatTestSnapshot();
                    const completedState = useAppStore.getState();
                    const completedProjectPath = String(completedState.currentProject?.path || '')
                        .trim()
                        .replace(/\\/g, '/')
                        .replace(/\/+$/, '')
                        .toLowerCase();
                    const completedModelId = String(completedState.modelPreferences?.primaryModel || '').trim();
                    const completedModel = getModelById(completedModelId);
                    const completedPhotoshopRuntimeResult = await executeToolCall('diagnoseState', {
                        verbose: false
                    });
                    const completedPhotoshopRuntimeIdentity = readDebugPhotoshopRuntimeIdentity(
                        completedPhotoshopRuntimeResult
                    );
                    const completedPhotoshopRuntimeBuildId = completedPhotoshopRuntimeIdentity?.buildId || '';
                    if (!completedPhotoshopRuntimeIdentity
                        || !debugBridgePhotoshopRuntimeLiveIdentitiesMatch(
                            completedPhotoshopRuntimeIdentity,
                            expectedPhotoshopRuntimeBinding.live
                        )) {
                        throw new Error(
                            `任务完成时 Photoshop Runtime 完整身份已变化或无法读取（期望 ${expectedPhotoshopRuntimeBuildId}，实际 ${completedPhotoshopRuntimeBuildId || 'unknown'}）。`
                        );
                    }
                    const firstPhotoshopMutationBaseline = readGuardedPhotoshopExecutionBaselineReceipt(
                        guardedPhotoshopExecutionBaseline
                    );
                    return {
                        snapshot,
                        receipt: {
                            version: 'debug-bridge-chat-submit-receipt/v1',
                            requestId: debugRequestId,
                            submittedProjectPath: currentProjectPath,
                            completedProjectPath,
                            expectedProjectMatchedAtSubmission: Boolean(
                                expectedProjectPath && currentProjectPath === expectedProjectPath
                            ),
                            projectUnchangedThroughCompletion: Boolean(
                                currentProjectPath && completedProjectPath === currentProjectPath
                            ),
                            photoshopDocumentPolicy: request.requireNoOpenPhotoshopDocuments === true
                                ? 'none_open'
                                : 'not_required',
                            openPhotoshopDocumentCountAtSubmission,
                            photoshopDocumentGuardPassedAtSubmission: Boolean(
                                request.requireNoOpenPhotoshopDocuments === true
                                && openPhotoshopDocumentCountAtSubmission === 0
                            ),
                            expectedPhotoshopRuntimeBuildId,
                            expectedPhotoshopRuntimeBinding,
                            submittedPhotoshopRuntimeIdentity,
                            completedPhotoshopRuntimeIdentity,
                            submittedPhotoshopRuntimeBuildId,
                            completedPhotoshopRuntimeBuildId,
                            expectedPhotoshopRuntimeMatchedAtSubmission: Boolean(
                                submittedPhotoshopRuntimeBuildId
                                && submittedPhotoshopRuntimeBuildId === expectedPhotoshopRuntimeBuildId
                            ),
                            photoshopRuntimeUnchangedThroughCompletion: Boolean(
                                submittedPhotoshopRuntimeBuildId
                                && completedPhotoshopRuntimeBuildId === submittedPhotoshopRuntimeBuildId
                            ),
                            photoshopRuntimeBindingMatchedAtSubmission:
                                debugBridgePhotoshopRuntimeLiveIdentitiesMatch(
                                    submittedPhotoshopRuntimeIdentity,
                                    expectedPhotoshopRuntimeBinding.live
                                ),
                            photoshopRuntimeBindingUnchangedThroughCompletion:
                                debugBridgePhotoshopRuntimeLiveIdentitiesMatch(
                                    completedPhotoshopRuntimeIdentity,
                                    submittedPhotoshopRuntimeIdentity
                                ),
                            firstPhotoshopMutationBaseline,
                            submittedModelId,
                            submittedApiModelId: String(submittedModel?.apiModelId || '').trim(),
                            completedModelId,
                            completedApiModelId: String(completedModel?.apiModelId || '').trim(),
                            provider: String(submittedModel?.provider || '').trim(),
                            modelUnchangedThroughCompletion: Boolean(
                                submittedModelId && completedModelId === submittedModelId
                            ),
                            expectedModelMatchedAtSubmission: Boolean(
                                expectedModelId
                                && (expectedModelId === submittedModelId
                                    || expectedModelId === String(submittedModel?.apiModelId || '').trim())
                                && (!expectedProvider
                                    || expectedProvider === String(submittedModel?.provider || '').trim())
                            ),
                            conversationId: String(completedState.currentConversationId || '').trim(),
                            finalArtifactRefs,
                            ...(skuDeliveryEvidence ? { skuDeliveryEvidence } : {}),
                            completedAt: new Date().toISOString()
                        }
                    };
                };
                if (request.disableSkillBridges === true) {
                    const { runWithSkillBridgesSuppressed } = await import('../services/skill-executors/skill-tools');
                    return await runWithSkillBridgesSuppressed(submitAndWait);
                }
                return await submitAndWait();
            } catch (error) {
                return buildDebugBridgeChatFailureEnvelope(buildDebugBridgeChatExecutionFailure({
                    stage: executionStage,
                    writePossible,
                    message: error instanceof Error ? error.message : String(error),
                    code: writePossible
                        ? 'renderer_execution_failed_after_handle_send'
                        : 'renderer_submission_rejected_before_handle_send',
                    requestId: String(request?.requestId || '').trim()
                }));
            } finally {
                if (activeDebugBridgeRequestIdRef.current === debugRequestId) {
                    activeDebugBridgeRequestIdRef.current = null;
                }
                cancelledDebugBridgeRequestIdsRef.current.delete(debugRequestId);
                clearDebugFinalArtifactCapture(debugRequestId);
            }
        });
        return () => {
            unsubscribe?.();
        };
    }, [buildChatTestSnapshot, handleSend, resetChatTestConversation]);

    /**
     * 快捷命令处理器
     * 对于常见的简单操作，直接执行而不调用 AI 模型
     * 大幅提升响应速度！
     */
    /**
     * 快捷命令处理
     * 
     * 设计原则：
     * - 只处理【单词级】的简单命令（撤销、保存、重做）
     * - 其他所有请求都交给 AI 处理，让 AI 理解用户意图
     * - 避免机械式的关键词匹配
     */
    const tryQuickCommand = async (input: string): Promise<{ handled: boolean; message?: string }> => {
        const trimmed = input.trim().toLowerCase();
        
        // ===== 只处理单词级的简单命令 =====
        
        // 撤销
        if (trimmed === '撤销' || trimmed === 'undo') {
            try {
                const result = await executeToolCall('undo', {});
                return { handled: true, message: result?.success ? '✅ 已撤销' : `❌ ${result?.error || '撤销失败'}` };
            } catch (e: any) {
                return { handled: true, message: `❌ ${e.message}` };
            }
        }
        
        // 重做
        if (trimmed === '重做' || trimmed === 'redo') {
            try {
                const result = await executeToolCall('redo', {});
                return { handled: true, message: result?.success ? '✅ 已重做' : `❌ ${result?.error || '重做失败'}` };
            } catch (e: any) {
                return { handled: true, message: `❌ ${e.message}` };
            }
        }
        
        // 保存（仅单词）
        if (trimmed === '保存' || trimmed === 'save') {
            try {
                const result = await executeToolCall('smartSave', {});
                return { handled: true, message: result?.message || (result?.success ? '✅ 已保存' : `❌ ${result?.error || '保存失败'}`) };
            } catch (e: any) {
                return { handled: true, message: `❌ ${e.message}` };
            }
        }
        
        // 其他所有请求都交给 AI 处理
        // AI 会理解用户意图，而不是机械式匹配关键词
        return { handled: false };
    };

    /**
     * 统一的 AI Agent 处理器
     * 
     * 新架构：
     * 1. AI 理解用户意图（不是关键词匹配）
     * 2. AI 选择工具/技能（根据理解做决策）
     * 3. 执行决策并返回结果
     * 4. 支持多轮对话
     */
    const handleUnifiedAgent = async (
        userInput: string,
        submissionImages?: DesignImageInput[],
        runOptions?: {
            runId?: string;
            conversationId?: string | null;
            publicPlanConfirmationSourceMessageId?: string;
            publicPlanConfirmationRequestId?: string;
            publicPlanDisposableLiveAdapter?: boolean;
            interactiveContinuationRequest?: InteractiveContinuationRequest;
            internalResumeRequest?: AgentInternalResumeRequest;
            providerNativeWebSearchIntent?: ChatWebSearchIntent;
            guardedPhotoshopExecutionBaseline?: GuardedPhotoshopExecutionBaseline;
            submission?: FrozenComposerSubmission;
        }
    ) => {
        // ========== Agent 执行流程：只展示真实模型反馈和真实工具事件 ==========
        
        // 创建 AbortController 用于取消任务
        const runId = runOptions?.runId || `agent-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const runConversationId = runOptions?.conversationId || useAppStore.getState().currentConversationId;
        const submissionState = useAppStore.getState() as any;
        const currentModelPreferences = submissionState?.modelPreferences || modelPreferences;
        const submissionModelPreferences = currentModelPreferences
            ? {
                ...currentModelPreferences,
                ...(currentModelPreferences.thinking
                    ? { thinking: { ...currentModelPreferences.thinking } }
                    : {})
            }
            : undefined;
        const submissionPrimaryModelId = String(submissionModelPreferences?.primaryModel || '').trim();
        const submissionModelThinkingEnabled = submissionPrimaryModelId
            ? resolveModelThinkingEnabledForCall(submissionPrimaryModelId, submissionModelPreferences)
            : false;
        const runConversationBranchId = String(
            (Array.isArray(submissionState?.conversations)
                ? submissionState.conversations.find((conversation: any) => (
                    String(conversation?.id || '').trim() === String(runConversationId || '').trim()
                ))?.branchId
                : '')
            || ''
        ).trim();
        const submissionProject = submissionState?.currentProject;
        const submissionProjectId = String(submissionProject?.id || '').trim();
        const submissionProjectPath = String(submissionProject?.path || '').trim();
        const submissionProjectName = String(submissionProject?.name || '').trim();
        const submissionWorkspaceObservedAt = new Date().toISOString();
        const submissionActiveWorkspacePage = String(activeWorkspacePage || '').trim() || undefined;
        const submissionWorkflowContext = toOperatingWorkflowContext(workflowSelectionContext);
        const frozenSubmission = runOptions?.submission;
        let submissionSelectedAssetContext: AssetSelectionContext | undefined;
        if (frozenSubmission) {
            submissionSelectedAssetContext = frozenSubmission.selectedAssetContext
                ? { ...frozenSubmission.selectedAssetContext }
                : undefined;
        } else if (selectedAssetContext) {
            submissionSelectedAssetContext = { ...selectedAssetContext };
        }
        const submissionSelectedEagleLibraryAsset = frozenSubmission?.selectedEagleLibraryAsset
            ? cloneEagleLibrarySelectionContext(frozenSubmission.selectedEagleLibraryAsset)
            : undefined;
        const submissionSelectedEagleAssetGroup = frozenSubmission?.selectedEagleAssetGroup?.length
            ? frozenSubmission.selectedEagleAssetGroup.map(cloneEagleAssetRef)
            : undefined;
        const submissionKnowledgeReferences = frozenSubmission
            ? frozenSubmission.knowledgeReferences.map((reference) => ({ ...reference }))
            : knowledgeReferences.map((reference) => ({ ...reference }));
        const controller = new AbortController();
        setAbortController(controller);
        const signal = controller.signal;
        activeAgentRunIdRef.current = runId;
        cancelledAgentRunIdsRef.current.delete(runId);
        activeAgentRunUiRef.current = {
            runId,
            conversationId: runConversationId,
            streamedAssistantMessageId: null,
            visibleSteps: [],
            stopMessageShown: false
        };

        const addRunAssistantMessage = (
            message: AssistantMessageWithOriginInput,
            origin: AssistantReplyOrigin
        ) => addLocalAssistantMessage(message, origin, { conversationId: runConversationId });

        const updateRunAssistantMessage = (
            messageId: string,
            updates: AssistantMessageUpdateWithOriginInput,
            origin: AssistantReplyOrigin
        ) => updateLocalAssistantMessage(messageId, updates, origin, { conversationId: runConversationId });

        const isActiveAgentRun = () => activeAgentRunIdRef.current === runId;
        const isRunCancelled = () => Boolean(signal.aborted || cancelledAgentRunIdsRef.current.has(runId));
        const canApplyRunUpdate = () => isActiveAgentRun() && !isRunCancelled();
        const throwIfRunStopped = () => {
            if (!isActiveAgentRun() || isRunCancelled()) {
                throw new Error('任务已取消');
            }
        };
        
        const thinkingStartTime = Date.now();
        const attachedImages = (submissionImages || []).map((image) => ({ ...image }));
        const hasAttachedImage = attachedImages.length > 0;
        
        // 收集可见执行结果。普通系统日志不能伪装成模型思考。
        const collectedSteps: ThinkingStep[] = [];
        const stepStartTimes: Record<string, number> = {};
        let thinkingStepId: string | null = null;
        const toolStepIdsByCallId = new Map<string, string>();

        const syncActiveRunVisibleSteps = (): void => {
            if (activeAgentRunUiRef.current?.runId !== runId) return;
            activeAgentRunUiRef.current.visibleSteps = [...collectedSteps];
        };
        
        // 添加可见步骤的辅助函数。
        const addStep = (step: Omit<ThinkingStep, 'id' | 'timestamp'>): string => {
            const id = `step-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            if (!canApplyRunUpdate()) {
                return id;
            }
            // 一字不差的连续重复只留一条（真机 2026-08-19：「结果需要复核：…没有全部成功」同一句连发 5 次、
            // Provider 截断恢复曾连续投影同义状态——Harness 每轮失败各发一步，模型也会逐字重述）。
            // 只去逐字重复：措辞不同的相邻思考各有信息量，不做模糊合并。
            const lastStep = collectedSteps[collectedSteps.length - 1];
            const normalizeStepText = (text: unknown) => String(text || '').replace(/\s+/g, '');
            if (lastStep
                && lastStep.type === step.type
                && !step.imageData
                && !lastStep.imageData
                && normalizeStepText(lastStep.content) === normalizeStepText(step.content)) {
                updateStep(lastStep.id, { status: step.status, content: step.content });
                return lastStep.id;
            }
            // 记下这一步发生时任务卡上「正在做」的条目：界面据此把过程挂到条目下（没有卡就不打标）。
            const activeCard = getActiveDesignTaskCard(runId);
            const taskItemId = activeCard ? resolveCurrentDesignTaskItemId(activeCard) : null;
            const newStep: ThinkingStep = {
                ...step,
                id,
                timestamp: Date.now(),
                ...(taskItemId ? { taskItemId } : {})
            };
            collectedSteps.push(newStep);
            stepStartTimes[id] = Date.now();
            syncActiveRunVisibleSteps();
            
            // 同步到 UI 状态
            setThinkingSteps([...collectedSteps]);
            if (isVisiblePonderingStep(newStep)) {
                setLiveActivity(null);
            }
            return id;
        };
        
        // 清理 AI 响应中可能残留的结构化 JSON 或工具调用标记。
        const cleanResponseContent = sanitizeUserVisibleAssistantBodyText;

        const hasVisibleAssistantPayload = (input: {
            content?: string;
            image?: any;
            thinkingSteps?: ThinkingStep[];
            executionSummary?: AgentExecutionSummary;
            agentTaskPlanPresentation?: AgentTaskPlanPresentation;
            businessVisualObservationFeedback?: BusinessSkillVisualObservationFeedback;
            agentTaskPublicPlanExecutionRequest?: any;
            agentTaskPublicPlanControlledRun?: any;
            skuDeliverySummary?: SkuDeliverySummary;
            interactiveCards?: InteractiveCardDefinition[];
        }): boolean => {
            if (cleanResponseContent(input.content || '').trim()) return true;
            if (input.image) return true;
            if (Array.isArray(input.thinkingSteps) && input.thinkingSteps.length > 0) return true;
            if (input.executionSummary?.userVisibleSummary) return true;
            if (input.executionSummary?.userVisibleNextStep) return true;
            if (input.agentTaskPlanPresentation) return true;
            if (input.businessVisualObservationFeedback?.userVisible === true) return true;
            if (input.agentTaskPublicPlanExecutionRequest) return true;
            if (input.agentTaskPublicPlanControlledRun) return true;
            if (input.skuDeliverySummary) return true;
            if (Array.isArray(input.interactiveCards) && input.interactiveCards.length > 0) return true;
            return false;
        };

        const buildMissingVisibleResultContent = (taskPlan: any): string => {
            const visibleState = taskPlan?.userVisibleState || taskPlan?.data?.userVisibleState;
            const summary = sanitizeUserVisibleAssistantBodyText(visibleState?.summary || '').trim();
            const nextStep = sanitizeUserVisibleAssistantBodyText(visibleState?.nextStep || '').trim();
            const stateText = [summary, nextStep ? `下一步：${nextStep}` : '']
                .filter(Boolean)
                .join('\n');
            return stateText
                || '这次没有拿到可展示的观察结果，我不能把它当成已完成。需要重新读取项目图片后再继续判断。';
        };
        
        // 非流式结果直接显示；普通对话的真实 token 流由 streamChatAsync 更新消息。
        const displayAssistantMessage = async (
            fullContent: string, 
            options?: {
                image?: any;
                thinkingSteps?: ThinkingStep[];
                executionSummary?: AgentExecutionSummary;
                agentTaskPlanPresentation?: AgentTaskPlanPresentation;
                assistantReplyOrigin?: AssistantReplyOrigin;
                agentRequestLifecycle?: AgentRequestLifecycleRecord;
                agentDiagnosticRecord?: AgentDiagnosticRecord;
                businessVisualObservationFeedback?: BusinessSkillVisualObservationFeedback;
                agentTaskPlan?: any;
                agentTaskPublicPlan?: any;
                agentTaskPublicPlanExecutionRequest?: any;
                agentTaskPublicPlanApprovalRecord?: any;
                agentTaskPublicPlanControlledRun?: any;
                skuDeliverySummary?: SkuDeliverySummary;
                interactiveCards?: InteractiveCardDefinition[];
                pendingInteractiveContinuation?: PendingInteractiveContinuation;
                conversationalModelFailure?: any;
            }
        ) => {
            if (!canApplyRunUpdate()) return;
            const cleanedContent = cleanResponseContent(fullContent);
            if (!hasVisibleAssistantPayload({
                content: cleanedContent,
                image: options?.image,
                thinkingSteps: options?.thinkingSteps,
                executionSummary: options?.executionSummary,
                agentTaskPlanPresentation: options?.agentTaskPlanPresentation,
                businessVisualObservationFeedback: options?.businessVisualObservationFeedback,
                agentTaskPublicPlanExecutionRequest: options?.agentTaskPublicPlanExecutionRequest,
                agentTaskPublicPlanControlledRun: options?.agentTaskPublicPlanControlledRun,
                skuDeliverySummary: options?.skuDeliverySummary,
                interactiveCards: options?.interactiveCards
            })) {
                return;
            }
            const publicPlanPayload = buildPublicPlanMessagePayload({
                agentTaskPublicPlanExecutionRequest: options?.agentTaskPublicPlanExecutionRequest,
                agentTaskPublicPlanControlledRun: options?.agentTaskPublicPlanControlledRun
            });

            const messageId = addRunAssistantMessage({
                content: cleanedContent,
                image: options?.image,
                thinkingSteps: options?.thinkingSteps,
                executionSummary: options?.executionSummary,
                agentTaskPlanPresentation: options?.agentTaskPlanPresentation,
                agentRequestLifecycle: options?.agentRequestLifecycle,
                agentDiagnosticRecord: options?.agentDiagnosticRecord,
                businessVisualObservationFeedback: options?.businessVisualObservationFeedback,
                agentTaskPlan: options?.agentTaskPlan,
                agentTaskPublicPlan: options?.agentTaskPublicPlan,
                agentTaskPublicPlanExecutionRequest: publicPlanPayload.agentTaskPublicPlanExecutionRequest,
                agentTaskPublicPlanApprovalRecord: options?.agentTaskPublicPlanApprovalRecord,
                agentTaskPublicPlanControlledRun: publicPlanPayload.agentTaskPublicPlanControlledRun,
                skuDeliverySummary: options?.skuDeliverySummary,
                interactiveCards: options?.interactiveCards,
                pendingInteractiveContinuation: options?.pendingInteractiveContinuation,
                conversationalModelFailure: options?.conversationalModelFailure,
                isThinking: false
            }, options?.assistantReplyOrigin || uiStatusReplyOrigin('agent-display:missing-result-origin'));
            cachePrivatePublicPlanOperationRequests(messageId, options?.agentTaskPublicPlanExecutionRequest);
        };

        const formatFailureContent = (
            message: string | undefined,
            summary: AgentExecutionSummary | undefined,
            feedback?: BusinessSkillVisualObservationFeedback
        ): string => {
            const userVisibleSummary = sanitizeUserVisibleAssistantBodyText(
                summary?.userVisibleSummary || ''
            ).trim();
            const userVisibleNextStep = sanitizeUserVisibleAssistantBodyText(
                summary?.userVisibleNextStep || ''
            ).trim();
            const assistantBody = sanitizeUserVisibleAssistantBodyText(message || '').trim();
            // 2026-08-19：没做完时正文也先用模型 / 结果自己的话；Harness 的状态投影（「本轮已经在 Photoshop 中…
            // 当前版本…下一步…」）只在没有任何正文时垫底——用户明确不要看这种口播。
            const visibleMessage = assistantBody
                || [userVisibleSummary, userVisibleNextStep]
                    .filter(Boolean)
                    .filter((item, index, list) => list.indexOf(item) === index)
                    .join('\n');

            return formatAssistantFailureContent({
                message: visibleMessage,
                businessVisualObservationFeedback: feedback
            });
        };

        const buildFallbackFailureContent = (
            feedback: BusinessSkillVisualObservationFeedback | undefined,
            taskPlan: any,
            executionResultSummary?: AgentExecutionSummary
        ): string => {
            const feedbackContent = formatAssistantBusinessVisualFeedbackContent({
                message: '',
                businessVisualObservationFeedback: feedback
            });
            if (feedbackContent.trim()) return feedbackContent.trim();

            const userVisibleSummary = sanitizeUserVisibleAssistantBodyText(
                executionResultSummary?.userVisibleSummary || ''
            ).trim();
            const userVisibleNextStep = sanitizeUserVisibleAssistantBodyText(
                executionResultSummary?.userVisibleNextStep || ''
            ).trim();
            const executionResultContent = [userVisibleSummary, userVisibleNextStep]
                .filter(Boolean)
                .filter((item, index, list) => list.indexOf(item) === index)
                .join('\n');
            if (executionResultContent) return executionResultContent;

            const visibleState = taskPlan?.userVisibleState || taskPlan?.data?.userVisibleState;
            const summary = sanitizeUserVisibleAssistantBodyText(visibleState?.summary || '').trim();
            const nextStep = sanitizeUserVisibleAssistantBodyText(visibleState?.nextStep || '').trim();
            const stateText = [summary, nextStep]
                .filter(Boolean)
                .filter((item, index, list) => list.indexOf(item) === index)
                .join('\n');
            if (stateText) {
                return ['当前处理没有完成。', stateText].join('\n');
            }

            return '当前处理没有完成，暂时没有可靠的设计结果可以展示。';
        };
        
        // 更新思维步骤
        const updateStep = (stepId: string, updates: Partial<ThinkingStep>) => {
            if (!canApplyRunUpdate()) return;
            const idx = collectedSteps.findIndex(s => s.id === stepId);
            console.log('[ChatPanel] updateStep 调用:', { stepId, idx, updates: updates.content?.substring(0, 30), stepCount: collectedSteps.length });
            if (idx !== -1) {
                // 如果状态变为完成，计算耗时
                if (updates.status === 'success' || updates.status === 'error') {
                    const startTime = stepStartTimes[stepId];
                    if (startTime) {
                        updates.duration = Date.now() - startTime;
                    }
                }
                collectedSteps[idx] = { ...collectedSteps[idx], ...updates };
                const newSteps = [...collectedSteps];
                syncActiveRunVisibleSteps();
                console.log('[ChatPanel] 更新后的步骤:', newSteps.map(s => ({ type: s.type, content: s.content?.substring(0, 20), status: s.status })));
                setThinkingSteps(newSteps);
                if (isVisiblePonderingStep(collectedSteps[idx])) {
                    setLiveActivity(null);
                }
            }
        };

        const visibleWebSearchIntent = runOptions?.providerNativeWebSearchIntent;
        let providerNativeWebSearchStepId: string | null = null;

        const canAttachProviderNativeWebSearchToModelCall = (options?: any): boolean => {
            if (!visibleWebSearchIntent) return false;
            if (options?.silent === true) return false;
            const purpose = String(options?.purpose || '').trim();
            if (!purpose) return true;
            return purpose === 'direct_response' || purpose === 'direct_response_repair';
        };

        const markProviderNativeWebSearchStarted = () => {
            if (!visibleWebSearchIntent || providerNativeWebSearchStepId) return;
            providerNativeWebSearchStepId = addStep({
                type: 'tool_call',
                content: formatChatWebSearchVisibleStep(visibleWebSearchIntent),
                toolName: 'providerNativeWebSearch',
                status: 'running'
            });
        };

        const markProviderNativeWebSearchCompleted = (response?: any) => {
            if (!visibleWebSearchIntent || !providerNativeWebSearchStepId) return;
            const citationCount = Array.isArray(response?.citations) ? response.citations.length : 0;
            updateStep(providerNativeWebSearchStepId, {
                content: formatChatWebSearchCompletedStep(visibleWebSearchIntent, { citationCount }),
                status: 'success',
                toolResult: citationCount > 0
                    ? { success: true, citationCount }
                    : { success: true }
            });
        };

        const markProviderNativeWebSearchFailed = () => {
            if (!visibleWebSearchIntent || !providerNativeWebSearchStepId) return;
            updateStep(providerNativeWebSearchStepId, {
                content: `${formatChatWebSearchVisibleStep(visibleWebSearchIntent)}（未完成）`,
                status: 'error',
                toolResult: { success: false }
            });
        };

        const mergeVisibleThinking = (current: string, next: string): string => {
            const currentText = String(current || '').trim();
            const nextText = String(next || '').trim();
            if (!currentText) return nextText;
            if (!nextText) return currentText;
            if (nextText.startsWith(currentText)) return nextText;
            if (currentText.includes(nextText)) return currentText;
            return `${currentText}\n\n${nextText}`;
        };

        const handleAgentStep = (event: AgentStepEvent) => {
            if (!canApplyRunUpdate()) return;
            // 模型回合：只更新实时活动（带起始时间，可显示已等待秒数），不进持久步骤流。
            // 用户反馈 2026-08-17：看图那一下常常 40–110 秒没有任何动静，会以为卡住了。
            const modelTurnActivity = buildVisibleAgentActivityFromModelTurnEvent(event);
            if (modelTurnActivity) {
                setLiveActivity(modelTurnActivity);
            } else if (isModelTurnFinishedEvent(event)) {
                setLiveActivity((current) => (current?.source === 'model_turn' ? null : current));
            }
            const activity = buildVisibleAgentActivityFromStepEvent(event);
            if (activity) {
                setLiveActivity(activity);
            }
            if (event?.title && isVisibleAgentProcessEvent(event)) {
                const content = formatAgentProcessEventContent(event);
                if (content) {
                    addStep({
                        type: getVisibleAgentProcessStepType(event),
                        content,
                        status: event.status
                    });
                }
                return;
            }
            if (!event?.title || !isVisibleAgentStepEvent(event)) return;
            const content = formatAgentToolEventContent(event);

            if (event.kind === 'tool_started') {
                // 工具开始 = 当前思考片段结束：把进行中的思考 step 收尾，并清空 thinking step 引用，
                // 让下一轮推理新建独立 step，从而思考与工具按时间交替（think→tool→think→tool），
                // 而不是把多轮推理累积进同一个 step（之前所有思考堆成一大段、和工具割裂的根因）。
                if (thinkingStepId) {
                    const prevThinking = collectedSteps.find(s => s.id === thinkingStepId);
                    if (prevThinking && prevThinking.status === 'running') {
                        updateStep(thinkingStepId, { status: 'success' });
                    }
                    thinkingStepId = null;
                }
                streamedThinkingStepId = null;
                const id = addStep({
                    type: 'tool_call',
                    content,
                    toolName: event.toolName,
                    status: 'running'
                });
                if (event.toolCallId) {
                    toolStepIdsByCallId.set(event.toolCallId, id);
                }
                return;
            }

            if (event.kind === 'tool_completed') {
                const stepId = event.toolCallId ? toolStepIdsByCallId.get(event.toolCallId) : undefined;
                const fallback = collectedSteps
                    .slice()
                    .reverse()
                    .find(step => step.type === 'tool_call' && step.toolName === event.toolName && step.status === 'running');
                const targetId = stepId || fallback?.id;
                if (targetId) {
                    updateStep(targetId, {
                        content,
                        status: event.status === 'success' ? 'success' : 'error'
                    });
                } else {
                    addStep({
                        type: 'tool_result',
                        content,
                        toolName: event.toolName,
                        status: event.status === 'success' ? 'success' : 'error'
                    });
                }
                return;
            }
        };
        
        // 活动 run 在首个 provider / 工具事件到达前也必须有可见状态。
        // 这里只表达正在发生的 Harness 上下文读取，不冒充模型思考或执行结论。
        clearThinkingSteps(false);
        setShowThinking(true);
        setLiveActivity(buildVisibleAgentActivityFromRunPhase('context_loading'));

        let hasVisibleStreamedAssistantContent = false;
        let streamedAssistantMessageId: string | null = null;
        // 本轮已投影到助手消息上的任务卡（用于察觉账本里的卡被评审器 / 车间改过后再同步）
        let projectedTaskCard: DesignTaskCard | null = null;
        let streamedThinkingStepId: string | null = null;

        const settleLiveThinkingBeforeAnswerStream = (): void => {
            if (hasVisibleStreamedAssistantContent) return;
            hasVisibleStreamedAssistantContent = true;
            collectedSteps
                .filter(step => step.type === 'thinking' && step.status === 'running')
                .forEach(step => updateStep(step.id, { status: 'success' }));
            setShowThinking(false);
            setLiveActivity(null);
        };

        const updateStreamedAssistantContent = (
            content: string,
            streamSource: {
                source: 'provider-visible-token-stream';
                modelId: string;
                isThinking?: boolean;
            }
        ) => {
            if (!canApplyRunUpdate()) return;
            if (streamSource.source !== 'provider-visible-token-stream' || !streamSource.modelId) return;
            const visibleContent = sanitizeUserVisibleAssistantBodyText(content);
            if (!visibleContent.trim()) return;

            settleLiveThinkingBeforeAnswerStream();
            const visibleContentOrigin = modelAuthoredReplyOrigin('agent-stream:visible-content');
            if (!streamedAssistantMessageId) {
                streamedAssistantMessageId = addRunAssistantMessage({
                    content: visibleContent,
                    isThinking: streamSource.isThinking ?? true
                }, visibleContentOrigin);
                if (activeAgentRunUiRef.current?.runId === runId) {
                    activeAgentRunUiRef.current.streamedAssistantMessageId = streamedAssistantMessageId;
                }
                setLiveActivity(null);
                return;
            }

            setLiveActivity(null);
            updateRunAssistantMessage(
                streamedAssistantMessageId,
                {
                    content: visibleContent,
                    isThinking: streamSource.isThinking ?? true
                },
                visibleContentOrigin
            );
        };

        const updateStreamedVisibleReasoning = (content: string, status: ThinkingStep['status'] = 'running') => {
            if (!canApplyRunUpdate()) return;
            if (hasVisibleStreamedAssistantContent) return;
            const visibleText = sanitizeUserVisibleThinkingText(content);
            if (!visibleText) return;
            setLiveActivity(null);
            if (!streamedThinkingStepId) {
                streamedThinkingStepId = addStep({
                    type: 'decision',
                    content: visibleText,
                    status
                });
                return;
            }
            updateStep(streamedThinkingStepId, {
                content: visibleText,
                status
            });
        };

        const finalizeStreamedAssistantMessage = (
            content: string,
            options?: {
                image?: any;
                thinkingSteps?: ThinkingStep[];
                executionSummary?: AgentExecutionSummary;
                agentTaskPlanPresentation?: AgentTaskPlanPresentation;
                assistantReplyOrigin?: AssistantReplyOrigin;
                agentRequestLifecycle?: AgentRequestLifecycleRecord;
                agentDiagnosticRecord?: AgentDiagnosticRecord;
                businessVisualObservationFeedback?: BusinessSkillVisualObservationFeedback;
                agentTaskPlan?: any;
                agentTaskPublicPlan?: any;
                agentTaskPublicPlanExecutionRequest?: any;
                agentTaskPublicPlanApprovalRecord?: any;
                agentTaskPublicPlanControlledRun?: any;
                skuDeliverySummary?: SkuDeliverySummary;
                interactiveCards?: InteractiveCardDefinition[];
                pendingInteractiveContinuation?: PendingInteractiveContinuation;
                conversationalModelFailure?: any;
            }
        ) => {
            if (!canApplyRunUpdate() || !streamedAssistantMessageId) return false;
            const publicPlanPayload = buildPublicPlanMessagePayload({
                agentTaskPublicPlanExecutionRequest: options?.agentTaskPublicPlanExecutionRequest,
                agentTaskPublicPlanControlledRun: options?.agentTaskPublicPlanControlledRun
            });
            const cleanedContent = cleanResponseContent(content);
            if (!hasVisibleAssistantPayload({
                content: cleanedContent,
                image: options?.image,
                thinkingSteps: options?.thinkingSteps,
                executionSummary: options?.executionSummary,
                agentTaskPlanPresentation: options?.agentTaskPlanPresentation,
                businessVisualObservationFeedback: options?.businessVisualObservationFeedback,
                agentTaskPublicPlanExecutionRequest: publicPlanPayload.agentTaskPublicPlanExecutionRequest,
                agentTaskPublicPlanControlledRun: publicPlanPayload.agentTaskPublicPlanControlledRun,
                skuDeliverySummary: options?.skuDeliverySummary,
                interactiveCards: options?.interactiveCards
            })) {
                return false;
            }
            updateAssistantMessageWithOrigin(streamedAssistantMessageId, {
                content: cleanedContent,
                image: options?.image,
                thinkingSteps: options?.thinkingSteps,
                executionSummary: options?.executionSummary,
                agentTaskPlanPresentation: options?.agentTaskPlanPresentation,
                agentRequestLifecycle: options?.agentRequestLifecycle,
                agentDiagnosticRecord: options?.agentDiagnosticRecord,
                businessVisualObservationFeedback: options?.businessVisualObservationFeedback,
                agentTaskPlan: options?.agentTaskPlan,
                agentTaskPublicPlan: options?.agentTaskPublicPlan,
                agentTaskPublicPlanExecutionRequest: publicPlanPayload.agentTaskPublicPlanExecutionRequest,
                agentTaskPublicPlanApprovalRecord: options?.agentTaskPublicPlanApprovalRecord,
                agentTaskPublicPlanControlledRun: publicPlanPayload.agentTaskPublicPlanControlledRun,
                skuDeliverySummary: options?.skuDeliverySummary,
                interactiveCards: options?.interactiveCards,
                pendingInteractiveContinuation: options?.pendingInteractiveContinuation,
                conversationalModelFailure: options?.conversationalModelFailure,
                isThinking: false
            }, options?.assistantReplyOrigin || uiStatusReplyOrigin('agent-stream:final-missing-origin'), runConversationId);
            cachePrivatePublicPlanOperationRequests(streamedAssistantMessageId, options?.agentTaskPublicPlanExecutionRequest);
            return true;
        };
        
        try {
            throwIfRunStopped();
            // 先完成可能较慢的项目读取并复核提交时项目身份，避免它消耗 Photoshop 基线的短 TTL。
            const projectContext = await getProjectContext({
                expectedProjectPresent: Boolean(submissionProject),
                expectedProjectId: submissionProjectId || undefined,
                expectedProjectPath: submissionProjectPath || undefined,
                selectedProjectImagePath: submissionSelectedAssetContext?.path
            });
            throwIfRunStopped();

            // Photoshop 环境事实必须在项目读取后、快照冻结前最后采集。
            // 连接状态来自主进程 WebSocket，而不是可能滞后的 React Store；文档与活动图层来自同一次 Host 观察。
            const photoshopRequestContext = await capturePhotoshopRequestContext({ signal });
            throwIfRunStopped();
            const photoshopContext = photoshopRequestContext.context;
            const capturedAt = new Date().toISOString();
            const operatingContextSnapshot = buildOperatingContextSnapshot({
                snapshotId: `operating:${runId}`,
                capturedAt,
                correlationId: runId,
                workspace: {
                    source: 'design-agent-workbench+project-context',
                    observedAt: submissionWorkspaceObservedAt,
                    revision: buildOperatingWorkspaceRevision({
                        projectId: projectContext?.projectId || submissionProjectId,
                        projectPath: projectContext?.projectPath || submissionProjectPath,
                        activePage: submissionActiveWorkspacePage,
                        workflowRevision: submissionWorkflowContext?.revision,
                        selectedAssetPath: submissionSelectedAssetContext?.path,
                        selectedLibraryAssetId: submissionSelectedEagleLibraryAsset
                            ? `${submissionSelectedEagleLibraryAsset.libraryId}:${submissionSelectedEagleLibraryAsset.itemId}`
                            : submissionSelectedEagleAssetGroup
                                ? `group:${submissionSelectedEagleAssetGroup.map((ref) => ref.itemId).join(',')}`
                                : undefined,
                        knowledgeBindingRefs: submissionKnowledgeReferences.map((reference) => reference.bindingRef)
                    }),
                    activePage: submissionActiveWorkspacePage,
                    project: {
                        projectId: projectContext?.projectId || submissionProjectId || undefined,
                        projectName: projectContext?.projectName || submissionProjectName || undefined,
                        projectPath: projectContext?.projectPath || submissionProjectPath || undefined
                    },
                    ...(submissionSelectedAssetContext ? {
                        selectedAsset: {
                            path: submissionSelectedAssetContext.path,
                            name: submissionSelectedAssetContext.name
                        }
                    } : {}),
                    ...(submissionSelectedEagleLibraryAsset ? {
                        selectedLibraryAsset: submissionSelectedEagleLibraryAsset
                    } : {}),
                    ...(submissionSelectedEagleAssetGroup ? {
                        selectedLibraryAssetGroup: submissionSelectedEagleAssetGroup
                    } : {}),
                    ...(submissionWorkflowContext ? { workflow: submissionWorkflowContext } : {}),
                    ...(submissionKnowledgeReferences.length > 0 ? {
                        knowledgeReferences: submissionKnowledgeReferences
                    } : {})
                },
                photoshop: {
                    source: photoshopRequestContext.source,
                    observedAt: photoshopRequestContext.observedAt,
                    revision: photoshopRequestContext.revision,
                    connection: photoshopRequestContext.connection,
                    documentState: photoshopRequestContext.documentState,
                    openDocuments: photoshopRequestContext.openDocuments,
                    ...(photoshopContext?.hasDocument && photoshopContext.documentId ? {
                        document: {
                            documentId: photoshopContext.documentId,
                            name: photoshopContext.documentName,
                            width: photoshopContext.canvasSize?.width,
                            height: photoshopContext.canvasSize?.height,
                            layerCount: photoshopContext.layerCount
                        }
                    } : {}),
                    ...(photoshopContext?.hasDocument && photoshopContext.activeLayerId ? {
                        activeLayer: {
                            layerId: photoshopContext.activeLayerId,
                            name: photoshopContext.activeLayerName
                        }
                    } : {})
                }
            });
            const stateForConversation = useAppStore.getState();
            const runConversation = runConversationId
                ? stateForConversation.conversations.find((conversation) => conversation.id === runConversationId)
                : undefined;
            const latestMessages = runConversation?.messages
                || (runConversationId === stateForConversation.currentConversationId
                    ? stateForConversation.messages
                    : []);
            const publicPlanConfirmationSourceMessage = runOptions?.publicPlanConfirmationSourceMessageId
                ? latestMessages.find(m => m.id === runOptions.publicPlanConfirmationSourceMessageId)
                : undefined;
            const sourcePublicPlanRequest = (publicPlanConfirmationSourceMessage as any)?.agentTaskPublicPlanExecutionRequest;
            const publicPlanConfirmationRequestId = String(
                runOptions?.publicPlanConfirmationRequestId || ''
            ).trim();
            const publicPlanOperationOwnerKey = buildPublicPlanPrivateOperationOwnerKey(
                runOptions?.publicPlanConfirmationSourceMessageId,
                publicPlanConfirmationRequestId
            );
            const hasExplicitPublicPlanConfirmation = hasExplicitGeneratedPublicPlanApproval({
                sourceMessageId: runOptions?.publicPlanConfirmationSourceMessageId,
                requestId: publicPlanConfirmationRequestId,
                sourceRequestId: sourcePublicPlanRequest?.requestId,
                sourceRequestStatus: sourcePublicPlanRequest?.status
            });
            const approvedWriteTools = Array.isArray(sourcePublicPlanRequest?.proposedWriteTools)
                ? sourcePublicPlanRequest.proposedWriteTools.filter((toolName: string) =>
                    Array.isArray(sourcePublicPlanRequest.allowedWriteTools)
                        && sourcePublicPlanRequest.allowedWriteTools.includes(toolName)
                )
                : [];
            const runtimePublicPlanLiveAdapterApproval = sourcePublicPlanRequest?.status === 'blocked_pending_user_confirmation'
                ? buildRuntimePublicPlanLiveAdapterApproval({
                    enabled: runOptions?.publicPlanDisposableLiveAdapter,
                    executeTool: executeToolCall,
                    projectPath: projectContext?.projectPath
                })
                : {};
            const agentTaskPublicPlanApproval = hasExplicitPublicPlanConfirmation
                ? {
                    userConfirmed: true,
                    allowedWriteTools: approvedWriteTools,
                    enableControlledExecutionRequest: true,
                    requestId: publicPlanConfirmationRequestId,
                    sourceMessageId: runOptions?.publicPlanConfirmationSourceMessageId,
                    runtimeOperationRequests: publicPlanOperationOwnerKey
                        ? publicPlanPrivateOperationRequestsRef.current[publicPlanOperationOwnerKey]
                        : undefined,
                    ...runtimePublicPlanLiveAdapterApproval
                }
                : undefined;
            
            // 构建 Agent 上下文
            const agentContext: AgentContext = {
                userInput,
                userSelectedSkillId: selectedComposerSkillId || undefined,
                requestId: runId,
                guardedPhotoshopExecutionBaseline: runOptions?.guardedPhotoshopExecutionBaseline,
                conversationId: runConversationId || undefined,
                selectedModelId: submissionPrimaryModelId || undefined,
                selectedModelThinkingEnabled: submissionModelThinkingEnabled,
                conversationBranchId: runConversationBranchId || undefined,
                interactiveContinuationRequest: runOptions?.interactiveContinuationRequest,
                internalResumeRequest: runOptions?.internalResumeRequest,
                conversationHistory: latestMessages
                    .filter(shouldIncludeMessageInAgentConversationHistory)
                    .map(m => ({
                        id: m.id,
                        role: m.role,
                        content: typeof m.content === 'string' ? m.content : '',
                        agentRequestLifecycle: m.agentRequestLifecycle,
                        executionSummary: m.executionSummary,
                        agentTaskPlan: m.agentTaskPlan,
                        agentTaskPublicPlan: m.agentTaskPublicPlan,
                        agentTaskPublicPlanExecutionRequest: m.agentTaskPublicPlanExecutionRequest,
                        agentTaskPublicPlanApprovalRecord: m.agentTaskPublicPlanApprovalRecord,
                        agentTaskPublicPlanControlledRun: m.agentTaskPublicPlanControlledRun,
                        interactiveCards: m.interactiveCards,
                        interactiveCardSubmissions: m.interactiveCardSubmissions,
                        pendingInteractiveContinuation: m.pendingInteractiveContinuation,
                        metadata: {
                            agentRequestLifecycle: m.agentRequestLifecycle,
                            executionSummary: m.executionSummary,
                            agentTaskPlan: m.agentTaskPlan,
                            agentTaskPublicPlan: m.agentTaskPublicPlan,
                            agentTaskPublicPlanExecutionRequest: m.agentTaskPublicPlanExecutionRequest,
                            agentTaskPublicPlanApprovalRecord: m.agentTaskPublicPlanApprovalRecord,
                            agentTaskPublicPlanControlledRun: m.agentTaskPublicPlanControlledRun,
                            interactiveCardSubmissions: m.interactiveCardSubmissions,
                            pendingInteractiveContinuation: m.pendingInteractiveContinuation
                        }
                    })),
                // 快照说了算，但「快照说不出」不等于「没连上」。
                //
                // resolveOperatingPhotoshopConnection 在快照缺失或 freshness !== 'current' 时返回 undefined
                // （即「这一刻我不确定」），而下游 agent-request-lifecycle 用 `=== true` 收敛，
                // undefined 会被折成 false，直接产出 blocked_missing_photoshop_connection 硬阻断。
                // 真机 2026-08-01：UXP 连接日志写着「✅ 已连接」、界面绿灯亮着、tools/call 也正常回包，
                // Agent 却回「需要先连接 Photoshop」——因为用户重启后 3 秒就发了消息，快照还没刷新。
                //
                // 不确定时回落到 store 的实时连接状态：它正是界面那盏绿灯的同一个数据源，
                // 由 WebSocket 连接/断开事件直接驱动，不存在新鲜度问题。
                isPluginConnected: resolveOperatingPhotoshopConnection(operatingContextSnapshot) ?? isPluginConnected,
                photoshopContext,
                projectContext,
                operatingContextSnapshot,
                designDimensionSpec,
                agentTaskPublicPlanApproval,
                resumeReadonlyToolHandlers: buildAgentResumeReadonlyToolHandlers({
                    executeToolCall,
                    projectContext
                }),
                hasAttachedImage,  // 传递图片状态
                attachedImageData: attachedImages[0]?.data,
                attachedImages,
                currentUserContentParts: frozenSubmission?.parts || [],
                providerNativeWebSearchIntent: runOptions?.providerNativeWebSearchIntent
            };

            const buildRequestNativeToolsForModel = (modelId: string, options?: any): ProviderNativeToolRequest[] => {
                if (!canAttachProviderNativeWebSearchToModelCall(options)) return [];
                const requestWebSearchIntent = runOptions?.providerNativeWebSearchIntent;
                const providerNativeIntent = toProviderNativeWebSearchIntent(
                    requestWebSearchIntent,
                    useAppStore.getState().designKnowledgeSettings || designKnowledgeSettings
                );
                if (!providerNativeIntent) return [];
                const model = getModelById(modelId);
                if (!model) return [];
                const plan = buildProviderNativeToolPlan({
                    provider: model.provider,
                    modelId: model.apiModelId || model.id,
                    requestedTools: [providerNativeIntent]
                });
                return plan.status === 'ready' ? plan.nativeTools : [];
            };

            // 调用模型的封装函数（支持图片 + 模型竞速优化）
            const callModel = async (msgs: Array<{ role: string; content: string | any[] }>, options?: any) => {
                const isRouterCall = options?.purpose === 'router' || options?.silent === true;
                const isVisibleReasoningCall = options?.purpose === 'visible_reasoning';
                const isDirectResponseCall = options?.purpose === 'direct_response';
                const isDirectResponseLikeCall = isDirectResponseCall || options?.purpose === 'direct_response_repair';
                const isSkillResultUserReplyCall = options?.purpose === 'skill_result_user_reply';
                const mustSuppressProviderThinking = isDirectResponseLikeCall
                    || isVisibleReasoningCall
                    || isSkillResultUserReplyCall;
                const deferVisibleStream = options?.deferVisibleStream === true;
                const shouldUseAttachedImages = hasAttachedImage && options?.includeAttachedImages !== false;
                const taskType: ConversationTaskType = resolveConversationTaskTypeForModelPurpose({
                    userInput,
                    hasImage: shouldUseAttachedImages,
                    purpose: options?.purpose,
                    silent: options?.silent === true
                });
                const userPrimaryModelId = submissionPrimaryModelId;
                // 单模型运行边界：普通回复、路由、工具循环与图像输入都只用用户选择的同一个
                // 已验证全模态模型。原生 web_search 不再成为偷偷换模型的理由；当前模型不支持时
                // 应走显式搜索工具或如实失败。
                const modelsToTry = userPrimaryModelId && isAgentMultimodalModelId(userPrimaryModelId)
                    ? [userPrimaryModelId]
                    : [];
                if (modelsToTry.length === 0) {
                    throw new Error(
                        `当前选择的 Agent 模型 ${userPrimaryModelId || '未配置'} 尚未确认同时具备读图与工具调用能力，`
                        + '本轮已停止且未改用其他模型。请在模型设置中刷新目录或选择视觉多模态 Agent 模型。'
                    );
                }
                agentLog(
                    'info',
                    `[ModelRouting] Agent 模型 ${taskType}/${options?.purpose || 'chat'}: ${modelsToTry[0]}`
                );
                const modelTimeoutMs = typeof options?.timeoutMs === 'number'
                    ? options.timeoutMs
                    : (isRouterCall || isVisibleReasoningCall || isDirectResponseLikeCall ? 15_000 : undefined);
                const modelErrors: string[] = [];
                const recordModelFailure = (modelId: string, reason: unknown) => {
                    const message = compactModelFailureText(reason) || 'model call failed';
                    modelErrors.push(`${modelId}: ${message}`);
                    agentLog('warn', `[ModelRouting] Agent 模型 ${modelId} 调用失败: ${message.slice(0, 220)}`);
                };
                
                if (shouldUseAttachedImages && !isRouterCall && !isVisibleReasoningCall) {
                    console.log('[ChatPanel] 📷 有附带图片，使用 Agent 模型:', modelsToTry.slice(0, 3).join(', '));
                    console.log('[ChatPanel] 📷 附带图片信息:', {
                        count: attachedImages.length,
                        hasData: !!attachedImages[0]?.data,
                        dataLength: attachedImages[0]?.data?.length,
                        type: attachedImages[0]?.mediaType,
                        msgCount: msgs.length
                    });
                    const orderedMessages = frozenSubmission
                        ? injectOrderedComposerSubmissionIntoMatchingUserMessage(
                            msgs,
                            userInput,
                            frozenSubmission
                        )
                        : null;
                    msgs = frozenSubmission
                        ? (orderedMessages || msgs)
                        : injectImagesIntoLastUserMessage(msgs, attachedImages);
                }
                
                // 兼容既有调用结构；单模型边界下这里只会执行一次。
                for (const modelId of modelsToTry) {
                    throwIfRunStopped();
                    const nativeTools = buildRequestNativeToolsForModel(modelId, options);
                    const modelRequestOptions = {
                        maxTokens: options?.maxTokens,
                        temperature: options?.temperature,
                        thinkingEnabled: options?.thinkingEnabled === false
                            ? false
                            : resolveModelThinkingEnabledForCall(modelId, submissionModelPreferences),
                        ...(nativeTools.length > 0 ? { nativeTools } : {})
                    };
                    if (nativeTools.length > 0) {
                        markProviderNativeWebSearchStarted();
                    }
                    
                    try {
                        const streamHasAttachedImage = isVisibleReasoningCall ? false : shouldUseAttachedImages;
                        if (!isRouterCall && canUsePlainTextProviderStream(msgs, options, {
                            hasAttachedImage: streamHasAttachedImage,
                            hasToolCalling: false
                        }) && nativeTools.length === 0) {
                            const streamOptions = {
                                maxTokens: options?.maxTokens,
                                temperature: options?.temperature,
                                thinkingEnabled: options?.thinkingEnabled === false
                                    ? false
                                    : resolveModelThinkingEnabledForCall(modelId, submissionModelPreferences),
                                timeoutMs: modelTimeoutMs
                            };
                            let streamedContentFromCall = '';
                            let streamError: unknown = null;

                            try {
                                const response = await streamChatAsync(
                                    modelId,
                                    msgs.map(message => ({
                                        role: message.role,
                                        content: String(message.content)
                                    })),
                                    {
                                        ...streamOptions,
                                        onProgress: (fullContent) => {
                                            streamedContentFromCall = fullContent;
                                            if (!canApplyRunUpdate()) return;
                                            if (isVisibleReasoningCall) {
                                                updateStreamedVisibleReasoning(fullContent);
                                            } else if (!deferVisibleStream) {
                                                updateStreamedAssistantContent(fullContent, {
                                                    source: 'provider-visible-token-stream',
                                                    modelId,
                                                    isThinking: true
                                                });
                                            }
                                        }
                                    }
                                );
                                throwIfRunStopped();

                                if (streamedThinkingStepId) {
                                    updateStep(streamedThinkingStepId, { status: 'success' });
                                }

                                const streamedText = String(response?.text || streamedContentFromCall || '').trim();
                                if (streamedText) {
                                    const streamedFailure = extractModelCallFailureMessage({
                                        ...response,
                                        text: streamedText
                                    });
                                    if (streamedFailure) {
                                        recordModelFailure(modelId, streamedFailure);
                                        continue;
                                    }
                                    console.log(`[ChatPanel] ✓ 模型 ${modelId} 流式调用成功`);
                                    return {
                                        text: streamedText,
                                        thinking: mustSuppressProviderThinking ? undefined : response?.thinking
                                    };
                                }
                            } catch (error) {
                                if (!canApplyRunUpdate() || signal.aborted || (error instanceof Error && error.message === '任务已取消')) {
                                    throw error;
                                }
                                streamError = error;
                                console.warn(`[ChatPanel] 模型 ${modelId} 流式调用失败，尝试非流式补救:`, error);
                            }

                            const fallbackResponse = await window.designEcho.chat(modelId, msgs, {
                                ...modelRequestOptions,
                                timeoutMs: modelTimeoutMs
                            });
                            throwIfRunStopped();
                            const fallbackFailure = extractModelCallFailureMessage(fallbackResponse);
                            if (fallbackFailure) {
                                recordModelFailure(modelId, fallbackFailure);
                                continue;
                            }
                            if (fallbackResponse?.text) {
                                console.log(`[ChatPanel] ✓ 模型 ${modelId} 流式为空或失败，非流式补救成功`);
                                return {
                                    ...fallbackResponse,
                                    thinking: mustSuppressProviderThinking ? undefined : fallbackResponse?.thinking
                                };
                            }

                            const streamErrorMessage = streamError instanceof Error
                                ? streamError.message
                                : streamError
                                    ? String(streamError)
                                    : 'empty stream response';
                            modelErrors.push(`${modelId}: ${streamErrorMessage}`);
                            continue;
                        }

                        const response = await window.designEcho.chat(modelId, msgs, {
                            ...modelRequestOptions,
                            timeoutMs: modelTimeoutMs
                        });
                        throwIfRunStopped();
                        const responseFailure = extractModelCallFailureMessage(response);
                        if (responseFailure) {
                            recordModelFailure(modelId, responseFailure);
                            continue;
                        }
                        if (response?.text) {
                            if (nativeTools.length > 0) {
                                markProviderNativeWebSearchCompleted(response);
                            }
                            console.log(`[ChatPanel] ✓ 模型 ${modelId} 调用成功`);
                            return {
                                ...response,
                                thinking: mustSuppressProviderThinking ? undefined : response?.thinking
                            };
                        }
                        modelErrors.push(`${modelId}: empty response`);
                    } catch (error) {
                        if (!canApplyRunUpdate() || signal.aborted || (error instanceof Error && error.message === '任务已取消')) {
                            throw error;
                        }
                        console.warn(`[ChatPanel] 模型 ${modelId} 调用失败:`, error);
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        modelErrors.push(`${modelId}: ${errorMessage}`);
                    }
                }
                
                console.warn('[ChatPanel] ⚠️ 当前 Agent 模型调用失败');
                markProviderNativeWebSearchFailed();
                const mergedError = Array.from(new Set(modelErrors)).slice(0, 3).join(' | ');
                throw new Error(mergedError || '当前 Agent 模型调用失败');
            };
            (callModel as any).supportsModelMediatedUserReply = true;
            
            // 追踪是否已收到思维内容
            let hasReceivedThinking = false;
            // 上一条已写入的思维日志：onThinking 是流式回调（每个增量触发一次）且日志按前
            // 200 字符截断，思考文本一超过这个长度，后续增量的日志内容就完全一样。
            // 真机一次运行里单条重复 233 次、96% 的思维日志是重复写入，每条都要走一次
            // IPC + 磁盘写。这里只在内容真正变化时才记录。
            let lastThinkingLogLine = '';
            
            // 检查是否已取消
            if (signal.aborted) {
                throw new Error('任务已取消');
            }

            // 执行统一 Agent 处理（只接收真实模型反馈和执行事件）
            setLiveActivity(current => buildVisibleAgentActivityFromRunPhase('agent_processing', current));
            const result = await processWithUnifiedAgent(agentContext, {
                callModel,
                signal,  // 传递取消信号
                callbacks: {
                    onStep: (event) => {
                        if (!canApplyRunUpdate()) return;
                        handleAgentStep(event);
                    },
                    onTaskPlanPresentation: (presentation) => {
                        if (!canApplyRunUpdate()) return;
                        const expectedProjectId = String(
                            operatingContextSnapshot.workspace.project?.projectId
                            || submissionProjectId
                            || 'workspace:none'
                        ).trim();
                        if (runConversationId
                            && presentation.identity.conversationId !== runConversationId) {
                            return;
                        }
                        if (presentation.identity.projectId !== expectedProjectId) return;

                        if (!streamedAssistantMessageId) {
                            streamedAssistantMessageId = addRunAssistantMessage({
                                content: '',
                                agentTaskPlanPresentation: presentation,
                                isThinking: true
                            }, uiStatusReplyOrigin('agent-task-plan:runtime-projection'));
                            if (activeAgentRunUiRef.current?.runId === runId) {
                                activeAgentRunUiRef.current.streamedAssistantMessageId = streamedAssistantMessageId;
                            }
                            return;
                        }

                        updateRunAssistantMessage(
                            streamedAssistantMessageId,
                            { agentTaskPlanPresentation: presentation },
                            uiStatusReplyOrigin('agent-task-plan:runtime-projection')
                        );
                    },
                    onSnapshotImage: (snapshot) => {
                        // 把 Agent 看过的画面快照内联到「判断与处理」步骤流（而非独立对话消息），
                        // 让用户在思考/处理过程中就近看到「Agent 看到的是什么」，位置更贴合上下文。
                        if (!canApplyRunUpdate()) return;
                        if (!snapshot?.data) return;
                        const snapshotDataUrl = snapshot.data.startsWith('data:')
                            ? snapshot.data
                            : `data:${snapshot.mediaType || 'image/jpeg'};base64,${snapshot.data}`;
                        addStep({
                            type: 'analyzing',
                            content: String(snapshot.label || '').trim() || '查看当前画面',
                            status: 'success',
                            imageData: snapshotDataUrl
                        });
                    },
                    onProgress: (message, percent) => {
                        if (!canApplyRunUpdate()) return;
                        agentLog('info', `[AI Agent] ${message} (${percent}%)`);
                        setLiveActivity((current) => (
                            buildVisibleAgentActivityFromProgress(message, current) || current
                        ));
                    },
                    onStatus: (message) => {
                        if (!canApplyRunUpdate()) return;
                        const content = String(message || '').trim();
                        if (!content) return;
                        agentLog('info', `[AI Agent] 状态: ${content}`);
                    },
                    onMessage: (message) => {
                        if (!canApplyRunUpdate()) return;
                        if (message && message.trim()) {
                            agentLog('info', `[AI Agent] 📌 进展: ${message.substring(0, 100)}...`);
                            setLiveActivity((current) => (
                                buildVisibleAgentActivityFromProgress(message, current) || current
                            ));
                        }
                    },
                    onToolStart: (toolName) => {
                        if (!canApplyRunUpdate()) return;
                        agentLog('info', `[AI Agent] 执行工具: ${toolName}`);
                        // 兼容回调只保留诊断记录。普通界面的工具过程必须来自 onStep 中
                        // 显式标记 audience=user + visibility=user_process 的事件。
                    },
                    onToolComplete: (toolName, toolResult) => {
                        if (!canApplyRunUpdate()) return;
                        agentLog('info', `[AI Agent] 工具完成: ${toolName}`, summarizeAgentToolResultForLog(toolResult));
                        // 结果仍由 Runtime / Run Record 完整记账；可见状态由结构化 onStep
                        // 完成事件更新，旧回调不再把每个内部 Tool 自动投影给用户。
                        // composeDesign 的选图依据属于模型原话，不是 Harness 的写入门禁。
                        // 若本轮可见内容尚未覆盖这条具体理由，则补投影一次；无关的长思考不能替代它。
                        if (toolName === 'composeDesign') {
                            const rationaleText = typeof toolResult?.materialSelectionReasonText === 'string'
                                && toolResult.materialSelectionReasonText.trim()
                                ? toolResult.materialSelectionReasonText
                                : toolResult?.designRationaleText;
                            if (typeof rationaleText === 'string' && rationaleText.trim()) {
                                const rationaleProjection = resolveMaterialSelectionReasonProjection({
                                    reasonText: rationaleText,
                                    visibleContents: collectedSteps.map((step) => step.content)
                                });
                                if (rationaleProjection) {
                                    addStep({
                                        type: 'thinking',
                                        content: rationaleProjection,
                                        status: 'success'
                                    });
                                }
                                if (typeof toolResult?.evaluation?.summary === 'string' && toolResult.evaluation.summary.trim()) {
                                    addStep({
                                        type: 'analyzing',
                                        content: `评审\n${toolResult.evaluation.summary.trim()}`,
                                        status: 'success'
                                    });
                                }
                            }
                        }
                        // 评审器 / 车间会直接改账本里的卡（如写入「验」栏）；运行中的卡跟着账本走。
                        {
                            const ledgerCard = getActiveDesignTaskCard(runId);
                            if (ledgerCard && streamedAssistantMessageId
                                && projectedTaskCard && projectedTaskCard.id === ledgerCard.id
                                && projectedTaskCard.updatedAt !== ledgerCard.updatedAt) {
                                projectedTaskCard = ledgerCard;
                                setLiveTaskCard(ledgerCard);
                                updateRunAssistantMessage(
                                    streamedAssistantMessageId,
                                    { designTaskCard: ledgerCard },
                                    uiStatusReplyOrigin('design-task-card:projection')
                                );
                            }
                        }
                        // 例外：设计任务卡（想 · 做 · 验）——模型立卡 / 打勾后把整卡投影到当前助手消息，
                        // 跨轮更新同一张卡，这是用户看「做到哪了」的界面。
                        if (
                            (toolName === 'planDesignTaskCard' || toolName === 'updateDesignTaskCard' || toolName === 'getDesignTaskCard')
                            && toolResult?.card && Array.isArray(toolResult.card.items)
                        ) {
                            projectedTaskCard = toolResult.card as DesignTaskCard;
                            setLiveTaskCard(toolResult.card);
                            if (!streamedAssistantMessageId) {
                                streamedAssistantMessageId = addRunAssistantMessage({
                                    content: '',
                                    designTaskCard: toolResult.card,
                                    isThinking: true
                                }, uiStatusReplyOrigin('design-task-card:projection'));
                                if (activeAgentRunUiRef.current?.runId === runId) {
                                    activeAgentRunUiRef.current.streamedAssistantMessageId = streamedAssistantMessageId;
                                }
                            } else {
                                updateRunAssistantMessage(
                                    streamedAssistantMessageId,
                                    { designTaskCard: toolResult.card },
                                    uiStatusReplyOrigin('design-task-card:projection')
                                );
                            }
                        }
                    },
                    onThinking: (thinking, meta) => {
                        if (!canApplyRunUpdate()) return;
                        if (hasVisibleStreamedAssistantContent) return;
                        // Runtime compatibility guard: older/untyped callers without provenance are hidden.
                        // Unknown source must never be promoted to model_visible_reasoning.
                        if (!meta?.source) return;
                        // 这里不再做第二次思考清洗：所有经 onThinking 到达的文本，都已在 Agent 侧
                        // emitVisibleReasoning → resolveVisibleReasoningTextForSource 按来源清洗过一次
                        // （default 分支即 sanitizeUserVisibleThinkingText）。清洗器有十道判空关卡，
                        // 过两遍等于关卡翻倍，把已经通过审查的内容再判空一次——过程区因此常年空白，
                        // 用户看不到 Agent 在想什么，也就无法及早发现它走错方向。
                        // 原先只给 model_reply_reasoning_prefix 开了豁免，但重复清洗对所有来源同样有害。
                        const visibleThinking = String(thinking || '').trim();
                        if (!visibleThinking) return;
                        const observation = classifyAgentObservationChannel({
                            source: meta.source,
                            content: visibleThinking
                        });
                        // 普通过程区只接收受控的模型公开判断；Provider 原始 thinking 在共享通道策略中隐藏。
                        if (canObservationEnterThinkingSteps(observation)) {
                            hasReceivedThinking = true;
                            const thinkingLogLine = `[AI Agent] 设计判断: ${visibleThinking.substring(0, 200)}...`;
                            if (thinkingLogLine !== lastThinkingLogLine) {
                                lastThinkingLogLine = thinkingLogLine;
                                agentLog('info', thinkingLogLine);
                                console.log('[ChatPanel] 更新公开设计判断:', { thinkingStepId, reasoning: visibleThinking.substring(0, 50) });
                            }
                            const targetThinkingStepId = thinkingStepId || streamedThinkingStepId;
                            if (!targetThinkingStepId) {
                                thinkingStepId = addStep({
                                    type: 'decision',
                                    content: visibleThinking,
                                    status: 'running'
                                });
                            } else {
                                thinkingStepId = targetThinkingStepId;
                                const currentStep = collectedSteps.find(s => s.id === targetThinkingStepId);
                                updateStep(targetThinkingStepId, {
                                    type: 'decision',
                                    content: mergeVisibleThinking(currentStep?.content || '', visibleThinking),
                                    status: 'running'
                                });
                            }
                        }
                    }
                }
            });
            const resultWasCancelled = (result as any).cancelled === true;
            const resultDisposition = decideAgentRunResultDisposition({
                isActiveRun: isActiveAgentRun(),
                runCancelled: isRunCancelled(),
                resultCancelled: resultWasCancelled
            });
            if (resultDisposition === 'ignore_stale_result') return;
            if (resultDisposition === 'reject_result_after_stop') {
                throw new Error('任务已取消');
            }
            
            // 计算处理时长
            const processingTime = Date.now() - thinkingStartTime;
            const hasToolExecution = result.toolResults && result.toolResults.length > 0;
            const executionSummary = readAgentExecutionSummaryFromResult(result);
            const resolvedVisibleResult = resolveAgentResultVisibleMessage(result);
            const resultVisibleMessage = resolvedVisibleResult.content;
            const assistantReplyOrigin = resolvedVisibleResult.assistantReplyOrigin;
            const agentRequestLifecycle = (result as any).data?.agentRequestLifecycle as AgentRequestLifecycleRecord | undefined;
            const agentDiagnosticRecord = buildAgentDiagnosticRecord((result as any).data);
            const businessVisualObservationFeedback = (result as any).data?.businessVisualObservationFeedback as BusinessSkillVisualObservationFeedback | undefined;
            const agentTaskPlan = (result as any).data?.agentTaskPlan;
            const runtimeResultData = (result as any).data;
            const hasRuntimeTaskSnapshot = Boolean(runtimeResultData)
                && Object.prototype.hasOwnProperty.call(runtimeResultData, 'runtimeTaskSnapshot');
            const runtimeTaskSnapshot = hasRuntimeTaskSnapshot
                ? readRuntimeTaskSnapshot(runtimeResultData.runtimeTaskSnapshot)
                : undefined;
            const agentTaskPlanPresentation = buildAgentTaskPlanPresentation({
                ...(hasRuntimeTaskSnapshot ? { runtimeTaskSnapshot: runtimeTaskSnapshot || null } : {}),
                taskPlan: agentTaskPlan,
                declaration: (result as any).data?.runtimeActionPlanDeclaration,
                reconciliation: (result as any).data?.runtimeActionPlanReconciliation,
                runtimeSessionDigest: (result as any).data?.runtimeSessionDigest,
                runtimeStageTrace: (result as any).data?.runtimeStageTrace,
                conversationId: runConversationId || undefined,
                projectId: operatingContextSnapshot.workspace.project?.projectId
                    || submissionProjectId
                    || 'workspace:none'
            });
            const agentTaskPublicPlan = (result as any).data?.agentTaskPublicPlan;
            const agentTaskPublicPlanExecutionRequest = (result as any).data?.agentTaskPublicPlanExecutionRequest;
            const agentTaskPublicPlanApprovalRecord = (result as any).data?.agentTaskPublicPlanApprovalRecord;
            const agentTaskPublicPlanControlledRun = (result as any).data?.agentTaskPublicPlanControlledRun;
            const skuDeliverySummary = (result as any).data?.skuDeliverySummary as SkuDeliverySummary | undefined;
            const interactiveCardsFromData = Array.isArray((result as any).data?.interactiveCards)
                ? (result as any).data.interactiveCards as InteractiveCardDefinition[]
                : [];
            const interactiveCardsFromTools = Array.isArray(result.toolResults)
                ? result.toolResults.flatMap((toolResult: any) => (
                    Array.isArray(toolResult?.result?.interactiveCards)
                        ? toolResult.result.interactiveCards
                        : []
                )) as InteractiveCardDefinition[]
                : [];
            // Agent 请求用户选择：卡片会暂停当前任务；提交后通过结构化内部恢复回到同一来源任务。
            const userChoiceRequest = (result as any).data?.userChoiceRequest;
            const userChoiceCards: InteractiveCardDefinition[] = userChoiceRequest?.version === 'user-choice-request/v2'
                ? [{
                    version: 'interactive-card/v0',
                    id: String(userChoiceRequest.id),
                    kind: 'user_choice',
                    title: String(userChoiceRequest.intro || userChoiceRequest.questions?.[0]?.question || '请你选一个'),
                    description: undefined,
                    payload: userChoiceRequest,
                    runDisposition: 'blocks_execution',
                    submitAction: 'submitUserChoice'
                }]
                : [];
            const interactiveCards = Array.from(
                [...userChoiceCards, ...interactiveCardsFromData, ...interactiveCardsFromTools]
                    .filter((card) => card?.version === 'interactive-card/v0')
                    .reduce((cardsById, card) => {
                        const cardId = String(card.id || '').trim();
                        if (cardId && !cardsById.has(cardId)) cardsById.set(cardId, card);
                        return cardsById;
                    }, new Map<string, InteractiveCardDefinition>())
                    .values()
            );
            const pendingInteractiveContinuation = (result as any).data
                ?.pendingInteractiveContinuation as PendingInteractiveContinuation | undefined;
            const conversationalModelFailure = (result as any).data?.conversationalModelFailure;
            const executionPresentationDisposition = resolveAgentExecutionPresentationDisposition({
                resultSuccess: result.success === true,
                executionStatus: executionSummary?.status
            });
            const presentsResult = executionPresentationDisposition === 'result';

            if (!resultWasCancelled && runOptions?.publicPlanConfirmationSourceMessageId && agentTaskPublicPlanApprovalRecord) {
                if (runConversationId) {
                    updateMessageInConversation(runConversationId, runOptions.publicPlanConfirmationSourceMessageId, {
                        agentTaskPublicPlanApprovalRecord
                    } as any);
                } else {
                    updateMessage(runOptions.publicPlanConfirmationSourceMessageId, {
                        agentTaskPublicPlanApprovalRecord
                    } as any);
                }
            }
            
            // 只有成功返回才把剩余步骤收为完成；失败必须把仍在运行的步骤标错，
            // 否则 UI 会先显示“全部成功”，随后又给出未完成卡片。
            const finalizedCollectedSteps = collectedSteps.map((step) => {
                if (step.status !== 'running' || resultWasCancelled) return step;
                const status = presentsResult ? 'success' as const : 'error' as const;
                updateStep(step.id, { status });
                return { ...step, status };
            });
            
            // 隐藏实时反馈（将显示在消息中）
            setShowThinking(false);
            setLiveActivity(null);
            
            // 检查是否是用户取消（优先处理）
            if (resultWasCancelled) {
                console.log('[AI Agent] 用户主动停止');
                finalizeAgentRunStopped(runId, 'agent-run:cancelled-result', {
                    executionSummary,
                    agentTaskPlanPresentation
                });
            } else if (presentsResult) {
                let responseContent = resultVisibleMessage;
                let generatedImage: { data: string; type: string } | undefined;
                const businessVisualFeedbackContent = formatAssistantBusinessVisualFeedbackContent({
                    message: responseContent,
                    businessVisualObservationFeedback
                });
                if (businessVisualFeedbackContent) {
                    responseContent = businessVisualFeedbackContent;
                }
                
                // 如果有工具结果，格式化显示
                if (hasToolExecution) {
                    // 检查是否有图片生成结果
                    const imageGenResult = result.toolResults!.find(tr => 
                        tr.toolName === 'generateImage' && tr.result?.imageData
                    );
                    if (imageGenResult?.result?.imageData) {
                        generatedImage = {
                            data: imageGenResult.result.imageData,
                            type: 'image/png'
                        };
                        responseContent = imageGenResult.result.message || resultVisibleMessage;
                    }
                }
                
                // 添加消息（仅包含真实模型反馈或真实工具事件）。
                // 普通聊天不保存固定系统日志，避免把硬编码流程包装成模型思考。
                const visibleProcessSteps = finalizedCollectedSteps.filter(
                    step => shouldPersistVisibleProcessStep(step, agentRequestLifecycle)
                );
                const hasVisibleProcessSteps = visibleProcessSteps.length > 0;
                const stepsToSave = hasVisibleProcessSteps
                    ? normalizePersistedVisibleProcessSteps(visibleProcessSteps)
                    : undefined;
                if (!hasVisibleAssistantPayload({
                    content: responseContent,
                    image: generatedImage,
                    thinkingSteps: stepsToSave,
                    executionSummary,
                    agentTaskPlanPresentation,
                    businessVisualObservationFeedback,
                    agentTaskPublicPlanExecutionRequest,
                    agentTaskPublicPlanControlledRun,
                    skuDeliverySummary,
                    interactiveCards
                })) {
                    responseContent = buildMissingVisibleResultContent(agentTaskPlan);
                }
                
                // 使用打字机效果显示最终回复
                if (!finalizeStreamedAssistantMessage(responseContent, {
                    image: generatedImage,
                    thinkingSteps: stepsToSave,
                    executionSummary,
                    agentTaskPlanPresentation,
                    assistantReplyOrigin,
                    agentRequestLifecycle,
                    agentDiagnosticRecord,
                    businessVisualObservationFeedback,
                    agentTaskPlan,
                    agentTaskPublicPlan,
                    agentTaskPublicPlanExecutionRequest,
                    agentTaskPublicPlanApprovalRecord,
                    agentTaskPublicPlanControlledRun,
                    skuDeliverySummary,
                    interactiveCards,
                    pendingInteractiveContinuation,
                    conversationalModelFailure
                })) {
                    await displayAssistantMessage(responseContent, {
                        image: generatedImage,
                        thinkingSteps: stepsToSave,
                        executionSummary,
                        agentTaskPlanPresentation,
                        assistantReplyOrigin,
                        agentRequestLifecycle,
                        agentDiagnosticRecord,
                        businessVisualObservationFeedback,
                        agentTaskPlan,
                        agentTaskPublicPlan,
                        agentTaskPublicPlanExecutionRequest,
                        agentTaskPublicPlanApprovalRecord,
                        agentTaskPublicPlanControlledRun,
                        skuDeliverySummary,
                        interactiveCards,
                        pendingInteractiveContinuation,
                        conversationalModelFailure
                    });
                }
                
                console.log(`[AI Agent] ✅ 完成，耗时 ${(processingTime/1000).toFixed(1)}s，思维步骤: ${collectedSteps.length}`);
                } else {
                const formattedFailureContent = formatFailureContent(
                    resultVisibleMessage,
                    executionSummary,
                    businessVisualObservationFeedback
                );
                const failureContent = sanitizeUserVisibleAssistantBodyText(formattedFailureContent).trim()
                    || buildFallbackFailureContent(businessVisualObservationFeedback, agentTaskPlan, executionSummary);
                const visibleFailureSteps = finalizedCollectedSteps.filter(
                    step => shouldPersistVisibleProcessStep(step, agentRequestLifecycle)
                );
                const failureStepsToSave = normalizePersistedVisibleProcessSteps(
                    filterRedundantFailureProcessSteps(visibleFailureSteps, failureContent)
                );
                if (!finalizeStreamedAssistantMessage(failureContent, {
                    thinkingSteps: failureStepsToSave,
                    executionSummary,
                    agentTaskPlanPresentation,
                    assistantReplyOrigin,
                    agentRequestLifecycle,
                    agentDiagnosticRecord,
                    businessVisualObservationFeedback,
                    agentTaskPlan,
                    agentTaskPublicPlan,
                    agentTaskPublicPlanExecutionRequest,
                    agentTaskPublicPlanApprovalRecord,
                    agentTaskPublicPlanControlledRun,
                    skuDeliverySummary,
                    interactiveCards,
                    pendingInteractiveContinuation,
                    conversationalModelFailure
                })) {
                    addRunAssistantMessage({
                        content: failureContent,
                        thinkingSteps: failureStepsToSave,
                        executionSummary,
                        agentTaskPlanPresentation,
                        agentRequestLifecycle,
                        agentDiagnosticRecord,
                        businessVisualObservationFeedback,
                        agentTaskPlan,
                        agentTaskPublicPlan,
                        agentTaskPublicPlanExecutionRequest,
                        agentTaskPublicPlanApprovalRecord,
                        agentTaskPublicPlanControlledRun,
                        skuDeliverySummary,
                        interactiveCards,
                        pendingInteractiveContinuation,
                        conversationalModelFailure
                    }, assistantReplyOrigin || uiStatusReplyOrigin('agent-run:failure-result'));
                }
            }
            
            // 清理思维步骤状态
            clearThinkingSteps();
            
        } catch (error: any) {
            console.error('[AI Agent] 处理失败:', error);
            // 注意：不再调用 removeLastMessage，因为现在没有添加 loading 消息
            
            // 检查是否是用户取消
            if (error.message === '任务已取消' || signal.aborted || cancelledAgentRunIdsRef.current.has(runId) || !isActiveAgentRun()) {
                console.log('[AI Agent] 任务已被用户取消');
                finalizeAgentRunStopped(runId, 'agent-run:cancelled-exception');
                return;
            }

            if (!canApplyRunUpdate()) {
                return;
            }
            
            // 标记所有运行中的步骤为错误
            collectedSteps.forEach(step => {
                if (step.status === 'running') {
                    updateStep(step.id, { status: 'error' });
                }
            });
            
            // 隐藏实时反馈
            setShowThinking(false);
            setLiveActivity(null);
            clearThinkingSteps();
            
            // 构建脱敏错误摘要。保留 quota / 429 / 鉴权等真实原因，不回退成笼统失败。
            const isCloud = submissionModelPreferences?.mode === 'cloud';
            const errorMsg = summarizeChatError(error, { isCloud });
            
            const errorStepsToSave = normalizePersistedVisibleProcessSteps(collectedSteps.filter(isVisiblePonderingStep));
            if (!finalizeStreamedAssistantMessage(errorMsg, {
                thinkingSteps: errorStepsToSave,
                assistantReplyOrigin: uiStatusReplyOrigin('agent-run:error')
            })) {
                addRunAssistantMessage({
                    content: errorMsg,
                    thinkingSteps: errorStepsToSave
                }, uiStatusReplyOrigin('agent-run:error'));
            }
        } finally {
            // 清理 AbortController
            if (activeAgentRunIdRef.current === runId) {
                setAbortController(null);
            }
        }
    };

    // 旧的 handleNaturalChat 函数已废弃，由 handleUnifiedAgent 替代

    // [已移除] handleQuickTaskExecute 函数 - 快捷任务模板功能
    // [已移除] 硬编码快速操作按钮相关函数
    // 用户应通过自然语言与 Agent 交互实现：优化文案、分析排版、智能文案等功能
    // [已移除] 原快速操作函数 handleQuickAction, handleSmartCopywriting, formatQuickActionResult
    // 这些功能现在应该通过与 Agent 自然语言交互来实现
    /**
     * 工具测试 - 验证 UXP 插件连接
     */
    // [已移除] handleQuickAction, handleSmartCopywriting, formatQuickActionResult
    // 这些功能现在通过 Agent 自然语言交互实现

    /**
     * 工具测试 - 验证 UXP 插件连接
     */
    const handleToolTest = async () => {
        if (!isPluginConnected) {
            addLocalBlockerMessage('⚠️ 请先连接 Photoshop 插件后再进行工具测试。', 'tool-test:photoshop-disconnected');
            return;
        }

        setLoading(true);
        addLocalStatusMessage('🧪 开始工具验证测试...', 'tool-test:started');

        const results: string[] = [];
        const testTool = async (name: string, method: string, params: any = {}): Promise<boolean> => {
            try {
                const result = await window.designEcho.sendToPlugin(method, params);
                if (result.success !== false) {
                    results.push(`✅ ${name}: 成功`);
                    return true;
                } else {
                    results.push(formatUserVisibleFailureLine(name, result.error));
                    return false;
                }
            } catch (error: any) {
                results.push(formatUserVisibleFailureLine(name, error));
                return false;
            }
        };

        try {
            // 1. 测试文档信息获取
            await testTool('获取文档信息', 'getDocumentInfo');

            // 2. 测试获取所有文本图层
            await testTool('获取文本图层', 'getAllTextLayers');

            // 3. 测试获取选中图层文本
            await testTool('获取选中文本', 'getTextContent');

            // 4. 测试获取文本样式
            await testTool('获取文本样式', 'getTextStyle');

            // 5. 测试获取历史记录
            await testTool('获取历史记录', 'getHistoryInfo');

            // 6. 测试画布截图
            await testTool('画布截图', 'getDocumentSnapshot', { maxWidth: 200, maxHeight: 200 });

            // 统计结果
            const passed = results.filter(r => r.startsWith('✅')).length;
            const failed = results.filter(r => r.startsWith('❌')).length;

            let summary = `\n\n📊 **测试结果：** ${passed}/${results.length} 通过\n\n`;
            summary += results.join('\n');

            if (failed > 0) {
                summary += '\n\n💡 **提示：** 某些测试失败可能是因为没有选中图层或没有打开文档。请确保：\n1. 在 Photoshop 中打开了一个文档\n2. 选中了一个文本图层（用于文本相关测试）';
            } else {
                summary += '\n\n🎉 所有工具测试通过！';
            }

            addLocalAssistantMessage({
                content: summary
            }, toolSummaryReplyOrigin('tool-test:result'));

        } catch (error: any) {
            addLocalAssistantMessage({
                content: formatUserVisibleFailureContent('测试过程中发生错误', error)
            }, toolSummaryReplyOrigin('tool-test:error'));
        } finally {
            setLoading(false);
        }
    };

    const handleDesktopDebug = async (rawCommand: string) => {
        const connectionStatus = await getPhotoshopConnectionStatus().catch(() => ({ connected: false, source: 'ipc' as const }));
        if (!connectionStatus.connected) {
            addLocalAssistantMessage({
                content: '⚠️ 桌面端联调需要先连接 Photoshop 插件。'
            }, deterministicBlockerReplyOrigin('desktop-debug:photoshop-disconnected'));
            return;
        }

        setLoading(true);
        addLocalAssistantMessage({
            content: '开始检查主图和详情页处理链路。'
        }, uiStatusReplyOrigin('desktop-debug:started'));

        try {
            const toolsResp = (await listPhotoshopMcpTools()) as PhotoshopMcpToolsListPayload;
            const tools = toolsResp?.tools || toolsResp?.result?.tools || [];
            const toolNames = new Set((tools || []).map((t: any) => t?.name).filter(Boolean));
            const requiredTools = ['getSubjectBounds', 'smartLayout', 'quickExport', 'parseDetailPageTemplate', 'fillDetailPage', 'exportDetailPageSlices'];
            const missingTools = requiredTools.filter((name) => !toolNames.has(name));

            const scenarios = rawCommand.toLowerCase().includes('quick')
                ? [
                    '请基于当前模板生成一版主图，突出价格和卖点',
                    '请优化当前详情页文案并自动适配换行'
                ]
                : [
                    '请基于当前模板生成一版主图，突出价格和卖点',
                    '请优化当前详情页文案并自动适配换行',
                    '把这组商品图应用到详情页模板并导出切片',
                    '再来一轮主图优化，输出800尺寸版本'
                ];

            const routeLines: string[] = [];
            for (const inputText of scenarios) {
                const decision = debugInferDecisionFromText(inputText);
                const target = decision.type === 'skill_execution'
                    ? '进入对应设计流程'
                    : decision.type === 'tool_call'
                        ? '直接处理画面'
                        : '只做判断说明';
                console.info('[desktop-debug:routing]', {
                    inputText,
                    type: decision.type,
                    skillId: decision.skillId,
                    toolNames: (decision.toolCalls || []).map((t) => t.toolName)
                });
                routeLines.push(`- ${inputText}\n  → ${target}`);
            }

            const findSubjectProbeLayerId = (layers: any[]): number | null => {
                for (const layer of layers || []) {
                    const id = Number(layer?.id);
                    const kind = String(layer?.kind || '').toLowerCase();
                    if (Number.isFinite(id) && id > 0 && kind !== 'group' && layer?.visible !== false) {
                        return Math.round(id);
                    }
                    const nested = findSubjectProbeLayerId(Array.isArray(layer?.children) ? layer.children : []);
                    if (nested) return nested;
                }
                return null;
            };

            const probeLines: string[] = [];
            let subjectProbeLayerId: number | null = null;

            try {
                const diagnosis = (await callPhotoshopMcpTool('diagnoseState', { verbose: false })) as PhotoshopMcpToolCallPayload;
                const failed = !!(diagnosis?.error || diagnosis?.isError === true || diagnosis?.success === false);
                probeLines.push(`${failed ? '未通过' : '通过'} Photoshop 状态检查`);
                console.info('[desktop-debug:diagnoseState]', { failed, error: (diagnosis as any)?.error });
            } catch (error: any) {
                probeLines.push(`未通过 Photoshop 状态检查`);
                console.info('[desktop-debug:diagnoseState]', { failed: true, error: error?.message || '调用异常' });
            }

            try {
                const hierarchy = (await callPhotoshopMcpTool('getLayerHierarchy', { includeHidden: false })) as PhotoshopMcpToolCallPayload;
                const failed = !!(hierarchy?.error || hierarchy?.isError === true || hierarchy?.success === false);
                const layers = Array.isArray((hierarchy as any)?.hierarchy) ? (hierarchy as any).hierarchy : [];
                subjectProbeLayerId = failed ? null : findSubjectProbeLayerId(layers);
                probeLines.push(`${failed ? '未通过' : '通过'} 图层结构检查`);
                console.info('[desktop-debug:getLayerHierarchy]', { failed, subjectProbeLayerId, error: (hierarchy as any)?.error });
            } catch (error: any) {
                probeLines.push(`未通过 图层结构检查`);
                console.info('[desktop-debug:getLayerHierarchy]', { failed: true, error: error?.message || '调用异常' });
            }

            if (subjectProbeLayerId) {
                try {
                    const subjectBounds = (await callPhotoshopMcpTool('getSubjectBounds', {
                        layerId: subjectProbeLayerId,
                        method: 'alpha'
                    })) as PhotoshopMcpToolCallPayload;
                    const failed = !!(subjectBounds?.error || subjectBounds?.isError === true || subjectBounds?.success === false);
                    probeLines.push(`${failed ? '未通过' : '通过'} 主体边界检查`);
                    console.info('[desktop-debug:getSubjectBounds]', { failed, subjectProbeLayerId, error: (subjectBounds as any)?.error });
                } catch (error: any) {
                    probeLines.push(`未通过 主体边界检查`);
                    console.info('[desktop-debug:getSubjectBounds]', { failed: true, subjectProbeLayerId, error: error?.message || '调用异常' });
                }
            } else {
                probeLines.push('未找到适合读取主体边界的可见图层，已跳过。');
                console.info('[desktop-debug:getSubjectBounds]', { skipped: true, reason: 'no visible normal layer' });
            }

            try {
                const detailTemplate = (await callPhotoshopMcpTool('parseDetailPageTemplate', { strict: false })) as PhotoshopMcpToolCallPayload;
                const failed = !!(detailTemplate?.error || detailTemplate?.isError === true || detailTemplate?.success === false);
                probeLines.push(`${failed ? '未通过' : '通过'} 详情页模板检查`);
                console.info('[desktop-debug:parseDetailPageTemplate]', { failed, error: (detailTemplate as any)?.error });
            } catch (error: any) {
                probeLines.push(`未通过 详情页模板检查`);
                console.info('[desktop-debug:parseDetailPageTemplate]', { failed: true, error: error?.message || '调用异常' });
            }

            console.info('[desktop-debug:summary]', {
                totalToolCount: tools.length,
                connectionSource: connectionStatus.source,
                missingTools
            });

            let report = `**设计联调检查（主图/详情页）**\n\n`;
            report += `- Photoshop 连接：已连接\n`;
            report += `- 关键处理项：${missingTools.length === 0 ? '完整' : `缺少 ${missingTools.length} 项`}\n\n`;
            report += `**任务判断**\n${routeLines.join('\n')}\n\n`;
            report += `**当前画面检查**\n${probeLines.join('\n')}\n\n`;
            report += `详细诊断已写入开发日志，聊天区只保留可读结论。`;

            addLocalAssistantMessage({
                content: report
            }, toolSummaryReplyOrigin('desktop-debug:report'));
        } catch (error: any) {
            addLocalAssistantMessage({
                content: formatUserVisibleFailureContent('桌面端联调失败', error)
            }, toolSummaryReplyOrigin('desktop-debug:failed'));
        } finally {
            setLoading(false);
        }
    };

    const handleCommand = (command: string) => {
        const cmd = command.toLowerCase().trim();
        const diagnosticsEnabled = isDiagnosticsCommandEnabled();

        if (cmd.startsWith('/desktop-debug')) {
            if (diagnosticsEnabled) {
                void handleDesktopDebug(command);
            } else {
                addLocalStatusMessage(
                    '这个内部检查命令只在开发验收模式下可用。',
                    'slash-command:diagnostics-disabled'
                );
            }
            return;
        }

        switch (cmd) {
            case '/optimize':
                handleOptimize();
                break;
            
            case '/help':
                addLocalAssistantMessage({
                    content: buildUserSlashHelpContent()
                }, uiStatusReplyOrigin('slash-command:help'));
                break;
            
            case '/test':
                if (diagnosticsEnabled) {
                    handleToolTest();
                } else {
                    addLocalStatusMessage(
                        '这个内部检查命令只在开发验收模式下可用。',
                        'slash-command:diagnostics-disabled'
                    );
                }
                break;

            case '/status':
                addLocalStatusMessage(`📊 **当前状态：**

- Photoshop 连接：${isPluginConnected ? '✅ 已连接' : '❌ 未连接'}
- Agent 版本：v1.0.0

${!isPluginConnected ? '\n⚠️ 请在 Photoshop 中加载 DesignEcho 插件以建立连接。' : ''}`,
                    'slash-command:status'
                );
                break;

            case '/clear':
                useAppStore.getState().clearMessages();
                addLocalStatusMessage('🧹 对话历史已清空。', 'slash-command:clear');
                break;

            case '/debug':
            case '/debug on':
                {
                    if (!diagnosticsEnabled) {
                        addLocalStatusMessage(
                            '这个内部检查命令只在开发验收模式下可用。',
                            'slash-command:diagnostics-disabled'
                        );
                        break;
                    }
                    const { toolLogger } = require('../services/tool-logger');
                    toolLogger.setDebugMode(true);
                    addLocalAssistantMessage({
                        content: `内部诊断已开启。

普通回复仍保持设计师表达；详细记录保存在本地诊断日志。

使用 \`/debug off\` 关闭内部诊断。`
                    }, uiStatusReplyOrigin('slash-command:debug-on'));
                }
                break;

            case '/debug off':
                {
                    if (!diagnosticsEnabled) {
                        addLocalStatusMessage(
                            '这个内部检查命令只在开发验收模式下可用。',
                            'slash-command:diagnostics-disabled'
                        );
                        break;
                    }
                    const { toolLogger } = require('../services/tool-logger');
                    toolLogger.setDebugMode(false);
                    addLocalStatusMessage('🔕 调试模式已关闭。', 'slash-command:debug-off');
                }
                break;

            case '/debug report':
                {
                    if (!diagnosticsEnabled) {
                        addLocalStatusMessage(
                            '这个内部检查命令只在开发验收模式下可用。',
                            'slash-command:diagnostics-disabled'
                        );
                        break;
                    }
                    const { toolLogger } = require('../services/tool-logger');
                    const report = toolLogger.generateDebugReport();
                    console.info('[debug-report]', report);
                    addLocalStatusMessage(
                        '内部诊断报告已写入开发日志，聊天区不展示底层记录。',
                        'slash-command:debug-report'
                    );
                }
                break;

            default:
                addLocalStatusMessage(
                    `❓ 未知命令：\`${command}\`\n\n输入 \`/help\` 查看可用命令。`,
                    'slash-command:unknown'
                );
        }
    };

    const handleComposerReferenceRemoved = useCallback((reference: ChatComposerReference): void => {
        composerRuntimeReferencesRef.current.delete(reference.referenceId);
        if (reference.source.kind !== 'uploaded_image') return;
        const imageId = reference.source.imageId;
        if (pendingComposerImageBytesRef.current.delete(imageId)) {
            setComposerPendingImageCount(pendingComposerImageBytesRef.current.size);
        }
        const nextImages = composerImagesRef.current.filter((image) => (
            image.id !== imageId
        ));
        composerImagesRef.current = nextImages;
        setComposerImages(nextImages);
    }, []);

    const handleComposerSnapshotChange = useCallback((
        snapshot: InlineMultimodalComposerSnapshot
    ): void => {
        const activeReferenceIds = new Set<string>();
        const activeImageIds = new Set<string>();
        for (const part of snapshot.parts) {
            if (part.type !== 'reference') continue;
            activeReferenceIds.add(part.reference.referenceId);
            if (part.reference.source.kind === 'uploaded_image') {
                activeImageIds.add(part.reference.source.imageId);
            }
        }
        for (const referenceId of Array.from(composerRuntimeReferencesRef.current.keys())) {
            if (!activeReferenceIds.has(referenceId)) {
                composerRuntimeReferencesRef.current.delete(referenceId);
            }
        }
        let pendingImagesChanged = false;
        for (const imageId of Array.from(pendingComposerImageBytesRef.current.keys())) {
            if (activeImageIds.has(imageId)) continue;
            pendingComposerImageBytesRef.current.delete(imageId);
            pendingImagesChanged = true;
        }
        if (pendingImagesChanged) {
            setComposerPendingImageCount(pendingComposerImageBytesRef.current.size);
        }
        const nextImages = composerImagesRef.current.filter((image) => activeImageIds.has(image.id));
        if (nextImages.length !== composerImagesRef.current.length) {
            composerImagesRef.current = nextImages;
            setComposerImages(nextImages);
        }
        setComposerSnapshot(snapshot);
        setInput(snapshot.text);
    }, []);

    let composerSendTitle = composerImages.length > 0 ? '发送图片和消息' : '发送消息';
    if (messageEditSession) {
        composerSendTitle = '请先完成当前消息编辑';
    } else if (composerPendingImageCount > 0) {
        composerSendTitle = '图片解析完成后即可发送';
    }

    return (
        <div className="chat-panel">
            <ConversationManager
                conversations={conversations}
                currentConversationId={currentConversationId}
                isBusy={isLoading}
                onCreateConversation={handleConversationCreate}
                onDeleteConversation={deleteConversation}
                onRenameConversation={updateConversationTitle}
                onReorderConversations={reorderConversations}
                onSwitchConversation={handleConversationSwitch}
                onBeforeActiveConversationChange={confirmActiveConversationChange}
            />

            {/* 消息列表：外层定位容器承载「回到最新」悬浮按钮，滚动仍发生在 messages-container 上 */}
            <div className="messages-scroll-region">
            <div
                className="messages-container"
                data-testid="chat-messages"
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
            >
                {messages.length === 0 ? (
                    <div className="welcome-message">
                        <div className="welcome-icon">🎨</div>
                        <h2>DesignEcho</h2>
                        <p>我是 DesignEcho，已加载当前项目的工作流，可以直接告诉我你的设计需求。</p>
                        
                        {/* [已移除] 快捷任务面板 - 使用自然语言交互代替 */}
                        
                    </div>
                ) : (
                    messages.map((msg) => {
                        const isEditing = messageEditSession?.messageId === msg.id;
                        const editHelpId = `message-edit-help-${msg.id}`;
                        const editRegeneratesFollowingMessages = Boolean(
                            messageEditSession?.truncatesFollowingMessages
                        );
                        const messageEditor = isEditing ? (
                            <div className="message-edit-container">
                                <InlineMultimodalComposer
                                    ref={messageEditComposerRef}
                                    className="message-edit-composer"
                                    testId={`chat-message-edit-input-${msg.id}`}
                                    ariaLabel="编辑用户消息。按 Ctrl 或 Command 加 Enter 发送，按 Esc 取消"
                                    ariaDescribedBy={
                                        editRegeneratesFollowingMessages ? editHelpId : undefined
                                    }
                                    placeholder="编辑这条消息…"
                                    submitMode="modifier-enter"
                                    disabled={messageEditSubmitting}
                                    onSubmit={() => {
                                        void handleConfirmMessageEdit();
                                    }}
                                    onCancel={() => resetMessageEditSession(true)}
                                    onPaste={handleMessageEditPaste}
                                    onReferenceRemoved={handleMessageEditReferenceRemoved}
                                    onChange={handleMessageEditSnapshotChange}
                                />
                                {messageEditSession?.warning && (
                                    <div className="message-edit-warning" role="status">
                                        {messageEditSession.warning}
                                    </div>
                                )}
                                {messageEditError && (
                                    <div className="message-edit-error" role="alert">
                                        {messageEditError}
                                    </div>
                                )}
                                <div className="message-edit-footer">
                                    {editRegeneratesFollowingMessages && (
                                        <span className="message-edit-consequence">
                                            <span id={editHelpId}>发送后将重新生成后续回复</span>
                                        </span>
                                    )}
                                    <div
                                        className="message-edit-actions"
                                        role="group"
                                        aria-label="消息编辑操作"
                                    >
                                        <button
                                            type="button"
                                            className="edit-cancel-btn"
                                            title="取消编辑（Esc）"
                                            onClick={() => resetMessageEditSession(true)}
                                            disabled={messageEditSubmitting}
                                        >
                                            取消
                                        </button>
                                        <button
                                            type="button"
                                            className="edit-confirm-btn"
                                            title="发送修改（Ctrl/Command + Enter）"
                                            onClick={() => {
                                                void handleConfirmMessageEdit();
                                            }}
                                            disabled={
                                                messageEditSubmitting
                                                || messageEditSnapshot.parts.length === 0
                                            }
                                        >
                                            {messageEditSubmitting ? '发送中…' : '发送'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : undefined;
                        const multimodalMsg = convertLegacyMessage(msg);
                        return (
                            <div
                                key={msg.id}
                                className="message-wrapper"
                                data-testid={`chat-message-${msg.role}`}
                                data-message-id={msg.id}
                                data-message-role={msg.role}
                            >
                                <MessageRenderer 
                                    message={multimodalMsg}
                                    isStreaming={msg.isThinking}
                                    onAction={handleMessageAction}
                                    editor={messageEditor}
                                    isEditing={isEditing}
                                    showEditButton={
                                        msg.role === 'user'
                                        && !isLoading
                                        && !messageEditSession
                                    }
                                    onEdit={() => handleStartEdit(msg)}
                                />
                                
                                {/* 保留旧版特殊组件：建议列表、布局修复列表 */}
                                {msg.suggestions && (
                                    <div className="message-extra-content">
                                        <SuggestionList 
                                            suggestions={msg.suggestions} 
                                            onApply={handleApplySuggestion}
                                        />
                                    </div>
                                )}
                                
                                {msg.layoutResult && (
                                    <div className="message-extra-content">
                                        <LayoutFixList
                                            result={msg.layoutResult}
                                            onApplyFix={handleApplyLayoutFix}
                                            onApplyAll={handleApplyAllLayoutFixes}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
                
                {/* 实时模型反馈 / 工具调用显示（加载过程中） */}
                {isLoading && activeAgentRunUiRef.current?.conversationId === currentConversationId && showThinking && (thinkingSteps.some(isVisiblePonderingStep) || liveActivity || liveTaskCard) && (
                    <div className="message assistant live-agent-message">
                        <div className="message-avatar">🤖</div>
                        <div className="message-content">
                            {liveTaskCard ? (
                                /* 有任务卡时，卡就是过程的容器：步骤挂在「正在做」的条目下，条目扫光。 */
                                <DesignTaskCardBlock
                                    block={{ id: `live-task-card-${liveTaskCard.id}`, type: 'design_task_card', card: liveTaskCard }}
                                    steps={appendLiveActivityStep(thinkingSteps, liveActivity, liveActivityNowMs)}
                                    live
                                />
                            ) : thinkingSteps.some(isVisiblePonderingStep) ? (
                                <ThinkingProcess
                                    steps={appendLiveActivityStep(thinkingSteps, liveActivity, liveActivityNowMs)}
                                    isExpanded={true}
                                    className="live-thinking"
                                />
                            ) : liveActivity ? (
                                <LiveActivityIndicator activity={liveActivity} nowMs={liveActivityNowMs} />
                            ) : null}
                        </div>
                    </div>
                )}
                
                <div ref={messagesEndRef} />
            </div>

            {!isPinnedToBottom && (
                <button
                    type="button"
                    className="scroll-to-latest-btn"
                    onClick={handleScrollToLatest}
                    aria-label="回到最新消息"
                    title="回到最新消息"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <polyline points="18 13 12 19 6 13"></polyline>
                    </svg>
                </button>
            )}
            </div>

            {/* 输入区域 */}
            <div className="input-container">
                {showUpload && (
                    <div className="upload-panel">
                        <div className="upload-header">
                            <span>上传参考图</span>
                            <button className="close-upload" onClick={() => setShowUpload(false)}>×</button>
                        </div>
                        <ReferenceUpload onUpload={handleImageUpload} isLoading={isLoading} />
                    </div>
                )}
                
                {showReplicator && (
                    <div className="replicator-panel">
                        <ReferenceReplicator 
                            isPluginConnected={isPluginConnected} 
                            onClose={() => setShowReplicator(false)}
                        />
                    </div>
                )}

                <div className="input-wrapper">
                    {/* 附件按钮 - 点击展开菜单 */}
                    <div className="attach-menu-container" ref={attachMenuContainerRef}>
                    <button
                            className={`attach-button ${showAttachMenu ? 'active' : ''}`}
                            onClick={() => {
                                if (messageEditSession) return;
                                setShowAttachMenu(!showAttachMenu);
                            }}
                            disabled={Boolean(messageEditSession)}
                            aria-haspopup="menu"
                            aria-expanded={showAttachMenu}
                            title={messageEditSession ? '请先完成当前消息编辑' : '插入素材、知识或图片'}
                        >
                            <Plus size={19} aria-hidden="true" />
                    </button>
                    
                        {/* 附件菜单 */}
                        {showAttachMenu && (
                            <div className="attach-menu" role="menu" aria-label="添加内容">
                                <button
                                    ref={firstAttachMenuItemRef}
                                    type="button"
                                    className="attach-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                        setShowAttachMenu(false);
                                        const fileInput = document.createElement('input');
                                        fileInput.type = 'file';
                                        fileInput.accept = 'image/jpeg,image/png,image/webp';
                                        fileInput.multiple = true;
                                        fileInput.onchange = (event) => {
                                            const files = Array.from(
                                                (event.target as HTMLInputElement).files || []
                                            );
                                            const remaining = Math.max(
                                                0,
                                                MAX_COMPOSER_IMAGES
                                                    - composerImagesRef.current.length
                                                    - pendingComposerImageBytesRef.current.size
                                            );
                                            for (const file of files.slice(0, remaining)) {
                                                readImageFileIntoComposer(file, 'chat-upload');
                                            }
                                        };
                                        fileInput.click();
                                    }}
                                >
                                    <span className="menu-icon" aria-hidden="true"><Upload size={16} /></span>
                                    <span>上传图片</span>
                                </button>
                                <button
                                    type="button"
                                    className="attach-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                        setShowAttachMenu(false);
                                        onRequestOpenWorkspacePage?.('eagle');
                                    }}
                                >
                                    <span className="menu-icon" aria-hidden="true"><Images size={16} /></span>
                                    <span>从 Eagle 选择</span>
                                </button>
                                <button
                                    type="button"
                                    className="attach-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                        setShowAttachMenu(false);
                                        onRequestOpenWorkspacePage?.('knowledge');
                                    }}
                                >
                                    <span className="menu-icon" aria-hidden="true"><BookOpen size={16} /></span>
                                    <span>从知识库选择</span>
                                </button>
                                <button
                                    type="button"
                                    className="attach-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                        setShowAttachMenu(false);
                                        onRequestOpenWorkspacePage?.('assets');
                                    }}
                                >
                                    <span className="menu-icon" aria-hidden="true"><FolderOpen size={16} /></span>
                                    <span>从项目素材选择</span>
                                </button>
                                <div className="attach-menu-separator" role="separator" />
                                <button
                                    type="button"
                                    className="attach-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                        setShowAttachMenu(false);
                                        captureScreenshotForChat('agent');
                                    }}
                                >
                                    <span className="menu-icon" aria-hidden="true"><Camera size={16} /></span>
                                    <span>截图 Agent 窗口</span>
                                </button>
                                <button
                                    type="button"
                                    className="attach-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                        setShowAttachMenu(false);
                                        captureScreenshotForChat('desktop');
                                    }}
                                >
                                    <span className="menu-icon" aria-hidden="true"><Monitor size={16} /></span>
                                    <span>截图桌面（含 Photoshop）</span>
                                </button>
                            </div>
                        )}
                    </div>
                    
                    <div 
                        ref={inputAreaRef}
                        className={`input-area ${composerDragKind ? 'dragging' : ''}`}
                        onDragEnter={handleDragEnter}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                    >
                        {/* 拖拽指示器 */}
                        {composerDragKind && (
                            <div className="drag-overlay">
                                <div className="drag-content">
                                    <Upload className="drag-icon" size={20} aria-hidden="true" />
                                    <span className="drag-text">
                                        {composerDragKind === 'eagle'
                                            ? '松开以添加 Eagle 素材到对话'
                                            : '松开以附加图片到对话'}
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* 已选技能胶囊：让「本次消息带着哪个技能」在输入框里一眼可见、可移除 */}
                        {selectedComposerSkillId && (
                            <div className="composer-skill-chip-row">
                                <span className="composer-skill-chip" data-testid="composer-skill-chip">
                                    <span className="composer-skill-chip-slug">/{selectedComposerSkillId}</span>
                                    <span className="composer-skill-chip-name">
                                        {getSkillById(selectedComposerSkillId)?.displayName || selectedComposerSkillId}
                                    </span>
                                    <button
                                        type="button"
                                        className="composer-skill-chip-clear"
                                        aria-label="移除已指定的技能，改回自动"
                                        onClick={() => setSelectedComposerSkillId(null)}
                                    >
                                        <X size={12} strokeWidth={2} aria-hidden="true" />
                                    </button>
                                </span>
                            </div>
                        )}

                        <InlineMultimodalComposer
                            ref={composerRef}
                            /* 占位只说"这里该填什么"这一件事。
                               「可在文字中间插入素材、知识或图片」挪到了 + 按钮的提示上：
                               那是真正执行插入的地方，写在这里既撑成两行，也不是用户此刻要做的动作。 */
                            placeholder={selectedComposerSkillId ? '已指定技能，直接描述需求即可…' : '输入设计需求…'}
                            onSubmit={() => handleSend()}
                            onPaste={handlePaste}
                            onReferenceRemoved={handleComposerReferenceRemoved}
                            onChange={handleComposerSnapshotChange}
                            disabled={Boolean(messageEditSession)}
                        />
                    </div>

                    {/* 底部工具条与输入区平级：附件、上下文胶囊、Thinking、模型、发送在同一行收齐。
                        三者的横向位置由 .input-wrapper 的 grid-template-areas 决定，
                        所以这里不需要按视觉顺序调整 JSX（附件按钮仍在源码上方）。 */}
                    {/* 工具条常驻：上下文环始终要在，不能因为「没有胶囊也没开 Thinking」整条消失 */}
                    <div className="input-toolbar">
                                {/* 上下文占用环：紧贴 Thinking 左侧，与它、模型图标构成右侧一组 */}
                                <ContextUsageIndicator usage={composerContextUsage} direction="up" />

                                {canShowThinkingModeToggle && (
                                    <ThinkingModeControl
                                        enabled={composerThinkingPreference.enabled}
                                        onToggle={handleToggleComposerThinking}
                                        direction="up"
                                    />
                                )}

                                {/* Skill 选择器：用户可显式指定本次任务的业务技能（默认自动交模型判断） */}
                                <SkillPickerControl
                                    selectedSkillId={selectedComposerSkillId}
                                    onSelect={setSelectedComposerSkillId}
                                    direction="up"
                                />

                                {/* Agent 拿不准时：问我（弹选项） / 全自动（它自己定并说明） */}
                                <DecisionModeControl
                                    mode={agentDecisionMode}
                                    onToggle={() => setAgentDecisionMode(agentDecisionMode === 'auto' ? 'ask' : 'auto')}
                                    direction="up"
                                />

                                {canShowComposerModelSelect && (
                                    <ModelPicker
                                        slot={composerModelSlot}
                                        groups={composerModelGroups}
                                        runModeLabel={composerRunModeLabel}
                                        direction="up"
                                    />
                                )}
                    </div>

                    {isLoading ? (
                        <button 
                            className="send-button stop-button"
                            onClick={() => {
                                console.log('[ChatPanel] 用户点击停止按钮');
                                stopGeneration();
                                // 停止即释放提交占用：stopGeneration 只复位 store 的 isLoading，
                                // 而发送守卫看的是这个 ref。不一起释放，界面会同时呈现「你已停止
                                // 此响应」和「当前已有设计任务正在执行」两个互相矛盾的状态。
                                chatSubmissionInFlightRef.current = null;
                                // Abort 必须先发生，不能让会话写入异常阻断真正的停止。
                                markActiveAgentRunStopped();
                                // 立即收束当前轮次；旧异步结果返回后会被 runId 守卫拦截。
                            }}
                            title="停止生成"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="6" width="12" height="12" rx="2" />
                            </svg>
                        </button>
                    ) : (
                        <button 
                            className="send-button"
                            data-testid="chat-send"
                            onClick={() => handleSend()}
                            disabled={
                                Boolean(messageEditSession)
                                || composerPendingImageCount > 0
                                || (!input.trim() && composerImages.length === 0)
                            }
                            title={composerSendTitle}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="19" x2="12" y2="5"></line>
                                <polyline points="6 11 12 5 18 11"></polyline>
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            <style>{`
                .chat-panel {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: 100%;
                    max-inline-size: 100%;
                    box-sizing: border-box;
                }

                /* 滚动区定位容器：只负责给「回到最新」按钮提供 absolute 锚点，
                   不改变 messages-container 原有的 flex/滚动行为。 */
                .messages-scroll-region {
                    position: relative;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    min-height: 0;
                    min-width: 0;
                    max-width: 100%;
                }

                .scroll-to-latest-btn {
                    position: absolute;
                    bottom: 14px;
                    left: 50%;
                    transform: translateX(-50%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    border: 1px solid var(--de-border);
                    background: var(--de-bg-card);
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    box-shadow: 0 2px 10px var(--de-shadow);
                    z-index: 5;
                }

                .scroll-to-latest-btn:hover {
                    color: var(--de-text);
                    border-color: var(--de-primary);
                }

                .messages-container {
                    flex: 1;
                    overflow-y: auto;
                    overflow-x: hidden;
                    padding: 24px;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: 100%;
                    max-inline-size: 100%;
                    box-sizing: border-box;
                }

                /* 多模态消息包装器 */
                .message-wrapper {
                    position: relative;
                    margin-bottom: 16px;
                    width: 100%;
                    inline-size: 100%;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: 100%;
                    max-inline-size: 100%;
                    overflow-x: hidden;
                    box-sizing: border-box;
                }

                .message-wrapper:last-child {
                    margin-bottom: 0;
                }

                .message-extra-content {
                    margin-left: 48px;
                    margin-top: 8px;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: calc(100% - 48px);
                    max-inline-size: calc(100% - 48px);
                    overflow-x: hidden;
                    box-sizing: border-box;
                }

                
                /* 编辑模式下的消息容器 */
                .message-wrapper.message {
                    display: flex;
                    gap: 12px;
                    padding: 16px 24px;
                    width: 100%;
                    inline-size: 100%;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: 100%;
                    max-inline-size: 100%;
                    box-sizing: border-box;
                    overflow-x: hidden;
                }
                
                .message-wrapper.message.user {
                    flex-direction: row-reverse;
                }
                
                .message-wrapper.message .message-content {
                    flex: 1;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: calc(100% - 60px);
                    max-inline-size: calc(100% - 60px);
                    overflow-wrap: anywhere;
                    word-break: break-word;
                }
                
                .message-wrapper.message .message-avatar {
                    width: 36px;
                    height: 36px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 18px;
                    flex-shrink: 0;
                    background: var(--de-avatar-bg, rgba(255, 255, 255, 0.05));
                }

                /* 欢迎信息 */
                .welcome-message {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    text-align: center;
                    animation: fadeIn 0.5s ease-out;
                }

                .welcome-icon {
                    font-size: 64px;
                    margin-bottom: 16px;
                }

                /* 渐变端点用主题 token：深色下与原先的 #fff→蓝 观感一致，
                   浅色下自动落到 深字→蓝，不再出现白字压浅底不可见的问题。
                   （原 'Space Grotesk' 字体从未被打包加载，引用已删，走 body 字体栈。） */
                .welcome-message h2 {
                    font-size: 28px;
                    font-weight: 600;
                    margin-bottom: 8px;
                    background: linear-gradient(135deg, var(--de-text) 0%, var(--de-primary) 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }

                .welcome-message p {
                    color: var(--de-text-secondary);
                    margin-bottom: 32px;
                }

                /* 消息 */
                .message {
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                    margin-bottom: 20px;
                    animation: slideUp 0.3s ease-out;
                    width: 100%;
                    inline-size: 100%;
                    flex: 0 0 auto;
                    align-self: stretch;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: 100%;
                    max-inline-size: 100%;
                    box-sizing: border-box;
                }

                .message.user {
                    flex-direction: row-reverse;
                }

                .message-avatar {
                    width: 36px;
                    height: 36px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--de-bg-light);
                    border-radius: 50%;
                    font-size: 18px;
                    flex-shrink: 0;
                }

                .message.user .message-avatar {
                    background: var(--de-primary);
                }

                .message-content {
                    flex: 1 1 0;
                    width: calc(100% - 48px);
                    inline-size: calc(100% - 48px);
                    max-width: min(70%, calc(100% - 48px));
                    max-inline-size: min(70%, calc(100% - 48px));
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                    min-inline-size: 0;
                    box-sizing: border-box;
                    overflow-wrap: anywhere;
                    word-break: break-word;
                }

                .message.live-agent-message .message-content {
                    flex: 1 0 calc(100% - 48px);
                    width: calc(100% - 48px);
                    inline-size: calc(100% - 48px);
                    min-width: min(320px, calc(100% - 48px));
                    min-inline-size: min(320px, calc(100% - 48px));
                    max-width: calc(100% - 48px);
                    max-inline-size: calc(100% - 48px);
                }

                .message.user .message-content {
                    flex: 0 1 min(70%, calc(100% - 48px));
                    width: auto;
                    inline-size: auto;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: min(70%, calc(100% - 48px));
                    max-inline-size: min(70%, calc(100% - 48px));
                    align-items: flex-end;
                }

                .message-text {
                    padding: 12px 16px;
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 12px;
                    font-size: 14px;
                    line-height: 1.6;
                    white-space: pre-wrap;
                    max-width: 100%;
                    max-inline-size: 100%;
                    box-sizing: border-box;
                    overflow-wrap: anywhere;
                    word-break: break-word;
                }

                .message.user .message-text {
                    background: var(--de-user-bubble-bg, var(--de-primary));
                    /* 边框走气泡边框色而不是和底色同色：中性灰气泡靠这道线成形 */
                    border-color: var(--de-user-bubble-border, var(--de-user-bubble-bg, var(--de-primary)));
                    color: var(--de-user-bubble-text, white);
                }

                .message-text strong {
                    color: var(--de-primary);
                    font-weight: 600;
                }

                .message.user .message-text strong {
                    color: #fff;
                }

                .message-text code {
                    background: rgba(0, 102, 255, 0.2);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 13px;
                }

                .message-text p {
                    margin: 0 0 8px 0;
                }

                .message-text p:last-child {
                    margin-bottom: 0;
                }

                /* 执行结果卡片 */
                .result-card {
                    border-radius: 12px;
                    overflow: hidden;
                    background: var(--de-bg);
                    min-width: 0;
                    max-width: 100%;
                    box-sizing: border-box;
                }

                .result-card.success {
                    border: 1px solid rgba(16, 185, 129, 0.4);
                    background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%);
                }

                .result-card.warning {
                    border: 1px solid rgba(245, 158, 11, 0.4);
                    background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(245, 158, 11, 0.02) 100%);
                }

                .result-header {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 14px 16px;
                    border-bottom: 1px solid var(--de-border);
                    min-width: 0;
                }

                .result-icon {
                    width: 24px;
                    height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    font-size: 14px;
                    font-weight: bold;
                }

                .result-card.success .result-icon {
                    background: rgba(16, 185, 129, 0.2);
                    color: #10b981;
                }

                .result-card.warning .result-icon {
                    background: rgba(245, 158, 11, 0.2);
                    color: #f59e0b;
                }

                .result-title {
                    font-size: 15px;
                    font-weight: 600;
                    color: var(--de-text);
                    min-width: 0;
                    overflow-wrap: anywhere;
                    word-break: break-word;
                }

                .result-details {
                    padding: 12px 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    min-width: 0;
                    max-width: 100%;
                    box-sizing: border-box;
                }

                .detail-row {
                    display: flex;
                    align-items: baseline;
                    gap: 8px;
                    font-size: 13px;
                    min-width: 0;
                    max-width: 100%;
                }

                .detail-label {
                    color: var(--de-text-secondary);
                    flex-shrink: 0;
                }

                .detail-value {
                    color: var(--de-text);
                    font-weight: 500;
                    min-width: 0;
                    overflow-wrap: anywhere;
                    word-break: break-word;
                }

                .result-list {
                    padding: 12px 16px;
                    border-top: 1px solid rgba(255, 255, 255, 0.05);
                    background: rgba(0, 0, 0, 0.15);
                    min-width: 0;
                    max-width: 100%;
                    box-sizing: border-box;
                }

                .list-header {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                    margin-bottom: 10px;
                    font-weight: 500;
                }

                .list-items {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    min-width: 0;
                    max-width: 100%;
                }

                .list-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 10px;
                    background: rgba(255, 255, 255, 0.03);
                    border-radius: 6px;
                    font-size: 12px;
                    min-width: 0;
                }

                .file-icon {
                    font-size: 14px;
                    opacity: 0.7;
                }

                .file-name {
                    color: var(--de-text);
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 11px;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .list-more {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                    padding: 6px 10px;
                    text-align: center;
                }

                .message-footer {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-top: 8px;
                }

                .message-time {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                }

                /* 上传面板 */
                .upload-panel {
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 12px;
                    padding: 12px;
                    margin-bottom: 12px;
                    animation: slideUp 0.2s ease-out;
                }

                .upload-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--de-text);
                }

                .close-upload {
                    background: none;
                    border: none;
                    color: var(--de-text-secondary);
                    font-size: 18px;
                    cursor: pointer;
                    padding: 4px;
                }

                .close-upload:hover {
                    color: var(--de-text);
                }

                /* 复刻面板 */
                .replicator-panel {
                    margin-bottom: 12px;
                    animation: slideUp 0.2s ease-out;
                }

                /* [已移除] 快速操作按钮样式 */

                .qa-icon {
                    font-size: 14px;
                }

                .qa-label {
                    font-weight: 500;
                }

                /* 输入区域 */
                .input-container {
                    padding: 16px 24px 24px;
                    background: linear-gradient(180deg, transparent 0%, var(--de-bg) 20%);
                }

                /* 输入区用 grid 而不是 flex row：视觉上是「上输入 / 下工具条」两行，
                   但附件按钮在 JSX 里仍排在输入区前面（它带一个展开菜单，挪动它要连菜单一起搬）。
                   grid-template-areas 让位置与 DOM 顺序解耦，避免为了排版去重排 80 多行 JSX。 */
                .input-wrapper {
                    display: grid;
                    grid-template-columns: auto minmax(0, 1fr) auto;
                    grid-template-areas:
                        "input   input     input"
                        "attach  toolbar   send";
                    column-gap: 6px;
                    row-gap: 6px;
                    align-items: center;
                    background: var(--de-bg-card);
                    /* 边框更淡、阴影更柔：让输入框像浮在页面上，而不是嵌在里面 */
                    border: 1px solid rgba(148, 163, 184, 0.16);
                    border-radius: 20px;
                    padding: 12px 12px 10px;
                    min-height: 120px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
                    transition: border-color 0.18s ease, box-shadow 0.18s ease;
                }

                .input-wrapper:focus-within {
                    border-color: rgba(148, 163, 184, 0.28);
                    box-shadow: 0 10px 36px rgba(0, 0, 0, 0.24);
                }

                .input-area {
                    grid-area: input;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    min-width: 0;
                    /* 输入区与底部工具条之间留出呼吸，是 lovart 那种松弛感的主要来源 */
                    padding: 2px 4px 6px;
                }
                
                /* 附件按钮 - 简洁的 + 号；位置由 grid-area 决定（底部工具条最左） */
                .attach-menu-container {
                    grid-area: attach;
                    position: relative;
                    align-self: center;
                }

                .attach-button {
                    background: transparent;
                    border: 1px solid transparent;
                    cursor: pointer;
                    padding: 6px;
                    border-radius: 50%;
                    transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    color: #2684ff;
                }

                .attach-button:hover {
                    background: rgba(38, 132, 255, 0.1);
                    border-color: rgba(38, 132, 255, 0.26);
                    color: #66aaff;
                }

                .attach-button:disabled {
                    opacity: 0.38;
                    cursor: not-allowed;
                    transform: none;
                }

                .attach-button.active {
                    color: #ffffff;
                    background: rgba(0, 102, 255, 0.18);
                    border-color: rgba(0, 102, 255, 0.36);
                    transform: rotate(45deg);
                }

                /* 附件菜单 */
                .attach-menu {
                    position: absolute;
                    bottom: calc(100% + 12px);
                    left: -8px;
                    width: 232px;
                    max-width: calc(100vw - 48px);
                    background: rgba(18, 18, 28, 0.98);
                    border: 1px solid rgba(76, 84, 110, 0.82);
                    border-radius: 12px;
                    padding: 8px;
                    box-shadow: 0 18px 44px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.02) inset;
                    z-index: 100;
                    backdrop-filter: blur(12px);
                }

                .attach-menu::after {
                    content: '';
                    position: absolute;
                    left: 20px;
                    bottom: -6px;
                    width: 10px;
                    height: 10px;
                    background: rgba(18, 18, 28, 0.98);
                    border-right: 1px solid rgba(76, 84, 110, 0.82);
                    border-bottom: 1px solid rgba(76, 84, 110, 0.82);
                    transform: rotate(45deg);
                }

                .attach-menu-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    width: 100%;
                    min-height: 42px;
                    padding: 8px 10px;
                    border: 1px solid transparent;
                    background: transparent;
                    color: var(--de-text);
                    font-size: 13px;
                    font-weight: 520;
                    line-height: 1.2;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
                    white-space: nowrap;
                    text-align: left;
                }

                .attach-menu-item:hover {
                    background: rgba(255, 255, 255, 0.065);
                    border-color: rgba(255, 255, 255, 0.08);
                    transform: translateX(1px);
                }

                .attach-menu-item.selected {
                    background: rgba(0, 102, 255, 0.16);
                    border-color: rgba(0, 102, 255, 0.26);
                    color: #8fbdff;
                }

                .attach-menu-item .menu-icon {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    flex: 0 0 28px;
                    width: 28px;
                    height: 28px;
                    border-radius: 8px;
                    background: rgba(255, 255, 255, 0.06);
                    color: #9db7df;
                    font-size: 10px;
                    font-weight: 700;
                    letter-spacing: 0;
                    font-variant-numeric: tabular-nums;
                }

                .attach-menu-item .menu-icon-image {
                    font-size: 9px;
                }

                .attach-menu-item:hover .menu-icon {
                    background: rgba(255, 255, 255, 0.09);
                    color: #d8e6ff;
                }

                .attach-menu-item.selected .menu-icon {
                    background: rgba(0, 102, 255, 0.24);
                    color: #ffffff;
                }

                .attach-menu-item .check-icon {
                    margin-left: auto;
                    color: #8fbdff;
                    font-size: 12px;
                }

                .attach-menu-separator {
                    height: 1px;
                    margin: 6px 8px;
                    background: rgba(255, 255, 255, 0.08);
                }

                .attach-menu-item .menu-icon svg {
                    width: 16px;
                    height: 16px;
                }

                .input-toolbar {
                    grid-area: toolbar;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-wrap: wrap;
                    min-height: 32px;
                    min-width: 0;
                }

                /* 上下文胶囊靠左；上下文环 / Thinking / 模型选择器成组顶到右侧。
                   谁是这一组的第一个由渲染条件决定，所以三者都写 margin-left:auto，
                   再用相邻兄弟选择器把后面的收回去——少一个都会在某种组合下塌掉。 */
                .input-toolbar .context-usage,
                .input-toolbar .thinking-mode-control,
                .input-toolbar .model-picker {
                    margin-left: auto;
                }

                .input-toolbar .context-usage ~ .thinking-mode-control,
                .input-toolbar .context-usage ~ .model-picker,
                .input-toolbar .thinking-mode-control ~ .model-picker {
                    margin-left: 0;
                }

                /* 生成模式标签 */
                .gen-spinner {
                    width: 16px;
                    height: 16px;
                    border: 2px solid var(--de-border);
                    border-top-color: var(--de-primary);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

                /* 输入栏 Agent 模型选择器的样式已迁到 ModelPicker.css（弹层版，带搜索与能力徽标） */

                .mode-close {
                    background: none;
                    border: none;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    font-size: 16px;
                    padding: 2px 6px;
                    line-height: 1;
                    border-radius: 4px;
                    transition: all 0.15s;
                }

                .mode-close:hover {
                    background: rgba(var(--de-danger-rgb, 239, 68, 68), 0.1);
                    color: var(--de-danger, #ef4444);
                }

                /* 发送键：高对比实心圆。
                   参考设计是浅色界面上的深色圆，直接照搬到深色主题会糊成一团看不见，
                   所以底色用 --de-text、图标用 --de-bg-card —— 跟着主题自动反色，
                   浅色主题下就是参考图里的深色圆，深色主题下是亮色圆，对比度两边都成立。 */
                .send-button {
                    grid-area: send;
                    width: 34px;
                    height: 34px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--de-text);
                    border: none;
                    border-radius: 50%;
                    color: var(--de-bg-card);
                    cursor: pointer;
                    transition: opacity 0.16s ease, transform 0.16s ease, background 0.16s ease;
                    flex-shrink: 0;
                }

                .send-button svg {
                    width: 17px;
                    height: 17px;
                }

                .send-button:hover:not(:disabled) {
                    transform: scale(1.06);
                }

                .send-button:disabled {
                    background: rgba(148, 163, 184, 0.18);
                    color: var(--de-text-secondary);
                    cursor: not-allowed;
                }

                .send-button.stop-button {
                    background: #ef4444;
                    color: #fff;
                    animation: pulse-stop 1.5s ease-in-out infinite;
                }

                .send-button.stop-button:hover {
                    background: #dc2626;
                    transform: scale(1.05);
                }

                @keyframes pulse-stop {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
                    50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
                }
                
                /* 参考图预览 */
                .reference-preview {
                    display: flex;
                    gap: 12px;
                    background: var(--de-bg-light);
                    padding: 8px;
                    border-radius: 8px;
                    margin-bottom: 8px;
                }
                
                .reference-preview img {
                    width: 60px;
                    height: 60px;
                    object-fit: cover;
                    border-radius: 4px;
                    border: 1px solid var(--de-border);
                }
                
                .reference-info {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 12px;
                    color: var(--de-text-secondary);
                }
                
                .analyze-btn {
                    padding: 4px 12px;
                    background: var(--de-primary);
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                }
                
                .analyze-btn:disabled {
                    opacity: 0.5;
                    cursor: wait;
                }

                /* 粘贴图片预览 */
                .pasted-image-preview {
                    display: flex;
                    gap: 12px;
                    background: linear-gradient(135deg, var(--de-bg-light), rgba(var(--de-primary-rgb), 0.1));
                    padding: 10px;
                    border-radius: 10px;
                    margin-bottom: 8px;
                    border: 1px solid rgba(var(--de-primary-rgb), 0.2);
                    animation: fadeIn 0.2s ease-out;
                }

                .pasted-image-preview img {
                    width: 80px;
                    height: 80px;
                    object-fit: cover;
                    border-radius: 6px;
                    border: 2px solid var(--de-primary);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }

                .pasted-image-info {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    font-size: 13px;
                    color: var(--de-text-primary);
                    font-weight: 500;
                }

                .remove-pasted-btn {
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    background: var(--de-bg);
                    border: 1px solid var(--de-border);
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    font-size: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.15s ease;
                }

                .remove-pasted-btn:hover {
                    background: var(--de-danger);
                    border-color: var(--de-danger);
                    color: white;
                }

                /* 拖拽状态 */
                .input-area {
                    position: relative;
                    transition: all 0.2s ease;
                }

                .input-area.dragging {
                    border-color: var(--de-primary);
                    background: rgba(var(--de-primary-rgb), 0.05);
                }

                .drag-overlay {
                    position: absolute;
                    inset: 0;
                    pointer-events: none;
                    background: rgba(var(--de-primary-rgb), 0.1);
                    backdrop-filter: blur(2px);
                    border: 2px dashed var(--de-primary);
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10;
                    animation: dragPulse 1s ease infinite;
                }

                @keyframes dragPulse {
                    0%, 100% { 
                        border-color: var(--de-primary);
                        background: rgba(var(--de-primary-rgb), 0.1);
                    }
                    50% { 
                        border-color: rgba(var(--de-primary-rgb), 0.6);
                        background: rgba(var(--de-primary-rgb), 0.15);
                    }
                }

                .drag-content {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    color: var(--de-primary);
                    font-weight: 500;
                }

                .drag-icon {
                    font-size: 32px;
                    animation: bounce 0.5s ease infinite alternate;
                }

                @keyframes bounce {
                    from { transform: translateY(0); }
                    to { transform: translateY(-5px); }
                }

                .drag-text {
                    font-size: 14px;
                    opacity: 0.9;
                }

                /* 消息中的图片显示 */
                .message-image {
                    margin-bottom: 12px;
                    border-radius: 8px;
                    overflow: hidden;
                    max-width: 300px;
                    border: 1px solid var(--de-border);
                }

                .message-image img {
                    width: 100%;
                    height: auto;
                    display: block;
                }

                .message.user .message-image {
                    margin-left: auto;
                }
                
                .remove-btn {
                    margin-left: auto;
                    background: none;
                    border: none;
                    font-size: 16px;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    padding: 4px;
                }
                
                .remove-btn:hover {
                    color: var(--de-text);
                }
            `}</style>
        </div>
    );
};
