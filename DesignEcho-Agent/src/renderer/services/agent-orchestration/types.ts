import type { DesignImageInput } from '../../../shared/design-image-input';
import type { DesignDimensionSpec } from '../../../shared/design-dimension-spec';
import type { AgentTaskPlanPresentation } from '../../../shared/agent-task-plan-presentation';
import type { ChatWebSearchIntent } from '../../../shared/chat-web-search-policy';
import type { ChatComposerContentPart } from '../../../shared/chat-composer-content';
import type { AgentResumableTaskMessageLike } from '../../../shared/agent-resumable-task-contract';
import type { AgentResumeReadonlyToolHandlers } from '../../../shared/agent-resume-context-pipeline';
import type { SkillExecutionOutcome } from '../../../shared/agent-react-observation-contract';
import type { SkillExecutionEffectReceipt } from '../../../shared/skill-execution-effect';
import type { ContextSnapshot, ProjectAssetIndex } from '../../../shared/project-asset-index';
import type { ProjectVisualInsightCacheReadResult } from '../../../shared/project-visual-insight-cache';
import type { ProjectVisualSamplingPlan } from '../../../shared/project-visual-sampling';
import type { AgentStepEvent } from '../agent-runtime';
import type { AgentTaskPublicPlanControlledOperationRequest } from '../../../shared/agent-task-public-plan-execution-request';
import type { AssistantReplyOrigin } from '../../../shared/assistant-reply-origin';
import type { OperatingContextSnapshot } from '../../../shared/agent-runtime-v5/operating-context-snapshot';
import type { InteractiveContinuationRequest } from '../../../shared/pending-interactive-continuation';
import type { AgentInternalResumeRequest } from '../../../shared/interactive-review-resume';
import type { GuardedPhotoshopExecutionBaseline } from '../../../shared/guarded-photoshop-execution-baseline';
import { resolveStableProjectMemoryScope } from '../../../shared/project-memory-scope';
import type {
    AgentTaskPublicPlanControlledAsyncAdapter,
    AgentTaskPublicPlanControlledRunnerTarget,
    AgentTaskPublicPlanLiveExecutionScope
} from '../../../shared/agent-task-public-plan-controlled-runner';

export interface AgentContext {
    userInput: string;
    /** 用户在输入框 Skill 选择器里显式指定的技能（codex 式：选择即权威提示；仅 selection-only，不执行不授权）。 */
    userSelectedSkillId?: string;
    conversationHistory: AgentResumableTaskMessageLike[];
    requestId?: string;
    /** 仅正式 disposable Debug 请求签发；不持久化、不进入模型参数。 */
    guardedPhotoshopExecutionBaseline?: GuardedPhotoshopExecutionBaseline;
    conversationId?: string;
    /** 用户提交瞬间冻结的单一 Agent 模型；运行中 UI 变化不得改写同一 TaskRun 的模型身份。 */
    selectedModelId?: string;
    selectedModelThinkingEnabled?: boolean;
    /** 当前对话消息树的分支身份；编辑重发后变化，用于隔离旧 Run Record。 */
    conversationBranchId?: string;
    interactiveContinuationRequest?: InteractiveContinuationRequest;
    internalResumeRequest?: AgentInternalResumeRequest;
    isPluginConnected?: boolean;
    photoshopContext?: PhotoshopContext;
    projectContext?: ProjectContext;
    operatingContextSnapshot?: OperatingContextSnapshot;
    designDimensionSpec?: Partial<DesignDimensionSpec>;
    hasAttachedImage?: boolean;
    attachedImageData?: string;
    attachedImages?: DesignImageInput[];
    /** 与当前 userInput 同一冻结事务产生的有序多模态内容。 */
    currentUserContentParts?: ChatComposerContentPart[];
    providerNativeWebSearchIntent?: ChatWebSearchIntent;
    visualEmbedding?: number[];
    layoutEmbedding?: number[];
    resumeReadonlyToolHandlers?: AgentResumeReadonlyToolHandlers;
    agentTaskPublicPlanApproval?: {
        userConfirmed?: boolean;
        approveGeneratedPublicPlan?: boolean;
        allowedWriteTools?: string[];
        enableControlledExecutionRequest?: boolean;
        requestId?: string;
        sourceMessageId?: string;
        runtimeOperationRequests?: AgentTaskPublicPlanControlledOperationRequest[];
        executionTarget?: AgentTaskPublicPlanControlledRunnerTarget;
        allowPhotoshopWrites?: boolean;
        liveExecutionScope?: AgentTaskPublicPlanLiveExecutionScope;
        explicitProjectWriteApproval?: boolean;
        adapter?: AgentTaskPublicPlanControlledAsyncAdapter;
    };
}

export interface PhotoshopContext {
    hasDocument: boolean;
    documentId?: number;
    historyStateRef?: { documentId: number; historyStateId: number };
    documentName?: string;
    canvasSize?: { width: number; height: number };
    activeLayerId?: number;
    activeLayerName?: string;
    layerCount?: number;
    observedAt?: string;
    revision?: string;
}

export interface ProjectContext {
    projectId?: string;
    projectName?: string;
    projectPath?: string;
    hasSkuFiles?: boolean;
    hasTemplates?: boolean;
    availableColors?: string[];
    projectImageCount?: number;
    projectImageFolders?: Array<{ path: string; imageCount: number }>;
    sampleImagePaths?: string[];
    selectedProjectImagePath?: string;
    selectedProjectImageName?: string;
    assetIndex?: ProjectAssetIndex;
    visualSamplingPlan?: ProjectVisualSamplingPlan;
    visualInsightCache?: ProjectVisualInsightCacheReadResult;
    contextSnapshot?: ContextSnapshot;
    contextSnapshotSource?: 'runtime-project-service' | 'renderer-project-structure';
    contextSnapshotWarnings?: string[];
    contextSnapshotLimitations?: string[];
}

export type AgentProjectMemoryScope =
    | { type: 'user' }
    | { type: 'project'; id: string };

export function resolveAgentProjectMemoryScope(
    projectContext?: Pick<ProjectContext, 'projectId' | 'projectPath'>
): AgentProjectMemoryScope {
    return resolveStableProjectMemoryScope({
        projectId: projectContext?.projectId,
        projectPath: projectContext?.projectPath
    });
}

export interface AgentDecision {
    type: 'tool_call' | 'skill_execution' | 'direct_response' | 'clarification_needed';
    toolCalls?: Array<{ toolName: string; params: any; reason?: string }>;
    skillId?: string;
    skillParams?: Record<string, any>;
    directResponse?: string;
    clarificationQuestion?: string;
    reasoning?: string;
}

export type AgentUserVisibleNoticeKind =
    | 'status_notice'
    | 'tool_summary'
    | 'blocker_notice';

export interface AgentUserVisibleNotice {
    kind: AgentUserVisibleNoticeKind;
    content: string;
    source?: string;
}

export interface AgentResult {
    success: boolean;
    message: string;
    /**
     * `success` 只表示没有致命执行错误；只有这里显式为 completed 才能声明任务完成。
     */
    skillOutcome?: SkillExecutionOutcome;
    /**
     * Skill 统一执行出口签发的真实效果收据。它只说明是否观察到 Photoshop mutation、
     * 是否正在等待交互或交还 Agent，不等于质量通过或任务完成。
     */
    skillExecutionReceipt?: SkillExecutionEffectReceipt;
    assistantReplyOrigin?: AssistantReplyOrigin;
    userVisibleNotice?: AgentUserVisibleNotice;
    toolResults?: any[];
    error?: string;
    /**
     * 结构化交接：这一步做完后，下一步可以走哪几个工具。
     *
     * 与 `error` 路径上的同名字段同一套语义：失败时报告恢复选项，成功时报告交接选项。
     * 它不授予权限、不裁剪下一轮工具面，也不替模型选择下一步；未完成义务仍由真实结果、
     * Evaluation 与交付契约判断。
     */
    nextRequiredToolOptions?: string[];
    /** 交接理由，人话，只作为下一轮的事实依据。 */
    nextRequiredToolReason?: string;
    cancelled?: boolean;
    /**
     * 非致命失败：技能已诚实报告"这步只做到了方案/部分结果"，不是执行错误。
     * 与 success:false 组合时，循环层按交接/部分结果处理，不当作同类工具连续失败，
     * 也不得被任何消费方升级为任务完成。
     */
    nonFatal?: boolean;
    data?: any;
}

import type { AgentThinkingEventMeta } from '../../../shared/agent-observation-channels';

export interface ExecutionCallbacks {
    onProgress?: (message: string, percent: number) => void;
    onStep?: (step: AgentStepEvent) => void;
    onStatus?: (message: string) => void;
    onToolStart?: (toolName: string) => void;
    onToolComplete?: (toolName: string, result: any) => void;
    onMessage?: (message: string) => void;
    onThinking?: (thinking: string, meta: AgentThinkingEventMeta) => void;
    /** R4 + reconciliation 的脱敏展示投影；只更新 UI，不拥有任务完成状态。 */
    onTaskPlanPresentation?: (presentation: AgentTaskPlanPresentation) => void;
    /** Agent 看过的画面快照，转发给用户（内联到「判断与处理」步骤流）。与 AgentCallbacks.onSnapshotImage 同签名。 */
    /** label 可选：默认「已查看当前画面」；导出 / 出稿收据可传「已导出：2双装/1白色+浅灰.jpg」这类标题。 */
    onSnapshotImage?: (snapshot: { data: string; mediaType: string; toolName: string; index: number; label?: string }) => void;
}

export interface ProcessOptions {
    callModel?: (messages: Array<{ role: string; content: any }>, options?: any) => Promise<{ text?: string; thinking?: string }>;
    callbacks?: ExecutionCallbacks;
    signal?: AbortSignal;
}

export interface DeterministicSkillRoute {
    skillId: string;
    skillParams: Record<string, any>;
    thinking?: string;
}

export type LightweightIntent =
    | 'greeting'
    | 'thanks'
    | 'ack'
    | 'identity'
    | 'model_compare'
    | 'capability'
    | 'task_summary'
    | 'continuation'
    | 'chat'
    | 'none';
