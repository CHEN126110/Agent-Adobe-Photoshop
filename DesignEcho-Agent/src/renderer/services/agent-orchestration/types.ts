import type { DesignImageInput } from '../../../shared/design-image-input';
import type { AgentResumableTaskMessageLike } from '../../../shared/agent-resumable-task-contract';
import type { AgentResumeReadonlyToolHandlers } from '../../../shared/agent-resume-readonly-context-executor';
import type { ContextSnapshot, ProjectAssetIndex } from '../../../shared/project-asset-index';
import type { ProjectVisualInsightCacheReadResult } from '../../../shared/project-visual-insight-cache';
import type { ProjectVisualSamplingPlan } from '../../../shared/project-visual-sampling';
import type { AgentStepEvent } from '../agent-runtime';

export interface AgentContext {
    userInput: string;
    conversationHistory: AgentResumableTaskMessageLike[];
    isPluginConnected: boolean;
    photoshopContext?: PhotoshopContext;
    projectContext?: ProjectContext;
    hasAttachedImage?: boolean;
    attachedImageData?: string;
    attachedImages?: DesignImageInput[];
    visualEmbedding?: number[];
    layoutEmbedding?: number[];
    resumeReadonlyToolHandlers?: AgentResumeReadonlyToolHandlers;
    agentTaskPublicPlanApproval?: {
        userConfirmed?: boolean;
        allowedWriteTools?: string[];
        enableControlledExecutionRequest?: boolean;
        requestId?: string;
        sourceMessageId?: string;
    };
}

export interface PhotoshopContext {
    hasDocument: boolean;
    documentName?: string;
    canvasSize?: { width: number; height: number };
    activeLayerName?: string;
    layerCount?: number;
}

export interface ProjectContext {
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

export interface AgentDecision {
    type: 'tool_call' | 'skill_execution' | 'direct_response' | 'clarification_needed';
    toolCalls?: Array<{ toolName: string; params: any; reason?: string }>;
    skillId?: string;
    skillParams?: Record<string, any>;
    directResponse?: string;
    clarificationQuestion?: string;
    reasoning?: string;
}

export interface AgentResult {
    success: boolean;
    message: string;
    toolResults?: any[];
    error?: string;
    cancelled?: boolean;
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
    onThinking?: (thinking: string, meta?: AgentThinkingEventMeta) => void;
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
