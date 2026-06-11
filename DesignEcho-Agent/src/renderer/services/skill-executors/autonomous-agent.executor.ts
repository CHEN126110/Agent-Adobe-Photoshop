import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { Agent, getDefaultAgentTools, selectTools } from '../agent-runtime';
import { DELEGATE_TOOL } from '../agent-runtime/tool-schemas';
import type { CallModelFn, CallModelStreamFn, ExecuteToolFn, AgentCallbacks, ToolSchema } from '../agent-runtime';
import { executeToolCall } from '../tool-executor.service';
import { streamChatWithToolsAsync } from '../agent-tool-stream.service';
import { useAppStore } from '../../stores/app.store';
import { getModelById } from '../../../shared/config/models.config';
import { buildDesignKnowledgeRuntimeCapabilitySummary } from '../../../shared/design-knowledge-runtime-capability';
import {
    DesignTeamCoordinator,
    getDesignTeammateDefinition
} from '../design-teams';
import type { DesignTeammateRole } from '../../../shared/types/design-team.types';
import { getModelPriorityForConversationTask, type ConversationTaskType } from '../../../shared/model-selection';
import { buildPhotoshopToolSemanticsSummary } from '../../../shared/photoshop-tool-semantics';
import { buildAutonomousAgentRuntimeBudget } from '../../../shared/agent-performance-policy';

function withDesignKnowledgeNativeTools(modelId: string, options?: Record<string, any>): Record<string, any> | undefined {
    const model = getModelById(modelId);
    if (!model) return options;

    const state = useAppStore.getState();
    const summary = buildDesignKnowledgeRuntimeCapabilitySummary({
        settings: state.designKnowledgeSettings,
        model
    });
    const providerNativeWebSearch = summary.providerNativeWebSearch;
    const hasExplicitNativeTools = Array.isArray(options?.nativeTools) && options.nativeTools.length > 0;

    if (providerNativeWebSearch.status !== 'ready' || hasExplicitNativeTools) {
        return options;
    }

    return {
        ...options,
        nativeTools: providerNativeWebSearch.nativeTools
    };
}

const callModelViaIPC: CallModelFn = async (modelId, messages, tools, options) => {
    return (window as any).designEcho.chatWithTools(
        modelId,
        messages,
        tools,
        withDesignKnowledgeNativeTools(modelId, options)
    );
};

const callModelStreamViaIPC: CallModelStreamFn = async (modelId, messages, tools, options) => {
    const {
        onContentDelta,
        onThinkingDelta,
        onToolCallDelta,
        onToolCallReady,
        ...modelOptions
    } = options || {};

    return streamChatWithToolsAsync(
        modelId,
        messages,
        tools,
        withDesignKnowledgeNativeTools(modelId, {
            ...modelOptions,
            onContentDelta,
            onThinkingDelta,
            onToolCallDelta,
            onToolCallReady
        })
    );
};

const DETAIL_PAGE_TOOL_NAMES = [
    'getDocumentInfo',
    'getLayerHierarchy',
    'getAllTextLayers',
    'parseDetailPageTemplate',
    'detectLayerIssues',
    'fixLayerIssues',
    'matchDetailPageContent',
    'fillDetailPage',
    'exportDetailPageSlices',
    'analyzeProjectForDetailPage',
    'searchProjectResources',
    'listProjectResources',
    'describeImage',
    'setTextContent',
    'getTextContent',
    'placeImage',
    'replaceLayerContent',
    'selectLayer',
    'getLayerBounds',
    'getLayerProperties',
    'generateImage',
    'getCanvasSnapshot',
    'getScreenSnapshots',
    'auditDetailPagePlacement',
    'getScreenSnapshotsWithOverlay'
];

const FALLBACK_MODELS = ['google-gemini-3-flash', 'google-gemini-3-pro', 'local-qwen2.5-7b'];

const designTeamCoordinator = new DesignTeamCoordinator({
    callModel: callModelViaIPC,
    executeTool: executeToolCall,
    resolveDefaultModelId: () => getModelId('logic')
});

async function executeDelegateToAgent(params: {
    role: DesignTeammateRole;
    task: string;
    context?: string;
}, callbacks?: AgentCallbacks, signal?: AbortSignal): Promise<any> {
    const { role, task, context: taskContext } = params;

    if (!role) {
        return { success: false, error: 'Missing teammate role' };
    }

    emitTeammateActivityStep(callbacks, role, 'started');

    const result = await designTeamCoordinator.runTeammateTask(
        {
            role,
            task,
            context: taskContext
        },
        {
            onToolStart: (name) => console.log(`[DesignTeammate:${role}] ${name}`)
        },
        signal
    );

    emitTeammateActivityStep(callbacks, role, result.success ? 'completed' : 'failed', result.error);

    return result;
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

function createExecuteToolWrapper(
    callbacks?: AgentCallbacks,
    signal?: AbortSignal
): ExecuteToolFn {
    return async (toolName, params) => {
        if (toolName === 'delegateToAgent') {
            return executeDelegateToAgent(params, callbacks, signal);
        }
        return executeToolCall(toolName, params);
    };
}

function buildBaseSystemPrompt(params: Record<string, any>, context?: any): string {
    const lines: string[] = [
        'You are DesignEcho desktop agent.',
        'You are not the UXP panel tool list. You are the desktop autonomous agent that plans and executes work by calling tools.',
        'Always gather enough context before editing. Inspect first, then act, then verify, then summarize.',
        'Prefer deterministic, non-destructive operations. Do not invent document state or project files.',
        'If the task is actionable, call tools. If the user is only chatting, answer directly in concise Chinese.',
        'When you call tools, put a short user-visible Chinese plan in the assistant content before the tool calls. This is a public summary, not private chain-of-thought.',
        'The visible plan should say what you understand, what you need to inspect, and why the next tool is useful. Do not claim completion before tools verify it.',
        'Final response must be concise Chinese that states what was done and the result.'
    ];

    const recognizedSkillParams = params.skillParams && typeof params.skillParams === 'object'
        ? JSON.stringify(params.skillParams)
        : '';

    if (params.skillId || params.intentMode || recognizedSkillParams) {
        lines.push(
            'Recognized intent context:',
            `- Suggested skill: ${params.skillId || 'none'}`,
            `- Suggested mode: ${params.intentMode || 'none'}`,
            `- Extracted constraints: ${recognizedSkillParams || 'none'}`
        );
    }

    if (params.skillId === 'detail-page-design') {
        lines.push(
            'For detail-page tasks, use this order:',
            '1. Inspect the current template with getDocumentInfo, getCanvasSnapshot, and parseDetailPageTemplate.',
            '2. Inspect project assets with analyzeProjectForDetailPage, listProjectResources, searchProjectResources, and describeImage.',
            '3. Build or refine plans with matchDetailPageContent.',
            '4. Apply with fillDetailPage and verify with getScreenSnapshots when needed.',
            '5. Export with exportDetailPageSlices only when the user asks for output.'
        );
    } else if (params.skillId === 'main-image-design') {
        lines.push(
            'For main-image tasks, inspect the document and current subject first.',
            'Use getDocumentInfo, getLayerHierarchy, getLayerBounds, getCanvasSnapshot, placeImage, moveLayer, quickScale, and styling tools as needed.',
            'Keep the product prominent and preserve editability.'
        );
    } else {
        lines.push(
            'For general actionable tasks, call Photoshop or project tools only when the user explicitly asks to inspect or modify a real document, layer, canvas, or project asset.',
            'If the request is a conversation, summary, progress report, capability question, or model question, answer directly and do not call tools.'
        );
    }

    lines.push(
        'Photoshop tool semantics available to this agent:',
        buildPhotoshopToolSemanticsSummary('text'),
        'Use the text semantics when planning createTextLayer, setTextContent, setTextStyle, resolveFontName, moveLayer, getLayerBounds, and getAcceptanceSnapshot.',
        'Boundary: text field readback can prove content/font/fontSize/tracking/leading fields, but it does not prove screenshot-level typography quality, glyph metrics, or reference-image fidelity.'
    );

    if (context?.photoshopContext) {
        lines.push(
            'Current Photoshop context:',
            `- Connected document: ${context.photoshopContext.hasDocument ? 'yes' : 'no'}`,
            `- Document name: ${context.photoshopContext.documentName || 'unknown'}`,
            `- Active layer: ${context.photoshopContext.activeLayerName || 'unknown'}`
        );
    }

    if (context?.projectContext?.projectPath) {
        lines.push(`Current project path: ${context.projectContext.projectPath}`);
    }

    return lines.join('\n');
}

function selectToolsForContext(params: Record<string, any>): ToolSchema[] {
    if (params.skillId === 'detail-page-design') {
        const tools = selectTools(DETAIL_PAGE_TOOL_NAMES);
        tools.push(DELEGATE_TOOL);
        return tools;
    }

    const tools = getDefaultAgentTools();
    tools.push(DELEGATE_TOOL);
    return tools;
}

function getModelId(taskType: ConversationTaskType = 'logic'): string {
    try {
        const state = useAppStore.getState();
        const prefs = (state as any).modelPreferences;
        const candidates = [
            ...getModelPriorityForConversationTask(prefs, taskType, {
                mode: prefs?.mode,
                includeFallback: prefs?.autoFallback,
                includeCrossTaskBackups: true,
                requireToolUse: true
            }),
            ...FALLBACK_MODELS
        ].filter(Boolean) as string[];

        const valid = candidates.find((id) => Boolean(getModelById(id)));
        return valid || FALLBACK_MODELS[0];
    } catch {
        return FALLBACK_MODELS[0];
    }
}

export const autonomousAgentExecutor: SkillExecutor = {
    skillId: 'autonomous-agent',

    async execute(executeParams: SkillExecuteParams): Promise<AgentResult> {
        const { params, callbacks, signal, context } = executeParams;
        const userTask = params.userTask || params.task || params.userInput || '';

        if (!userTask) {
            return {
                success: false,
                message: '未提供任务描述。',
                error: 'Missing userTask'
            };
        }

        const modelId = params.modelId || getModelId(Array.isArray(params.images) && params.images.length > 0 ? 'visual' : 'logic');
        const runtimeBudget = buildAutonomousAgentRuntimeBudget({
            requestedMaxIterations: params.maxIterations
        });
        const maxIterations = runtimeBudget.maxIterations;

        const agentCallbacks: AgentCallbacks = {
            onThinking: callbacks?.onThinking,
            onStep: callbacks?.onStep,
            onToolStart: callbacks?.onToolStart,
            onToolComplete: callbacks?.onToolComplete,
            onProgress: callbacks?.onProgress,
            onMessage: callbacks?.onMessage,
            onIterationComplete: (iteration, max) => {
                callbacks?.onProgress?.(`处理进度 ${iteration}/${max}`, Math.round((iteration / max) * 100));
            }
        };

        const agent = new Agent(
            {
                systemPrompt: buildBaseSystemPrompt(params, context),
                tools: selectToolsForContext(params),
                modelId,
                maxIterations,
                signal,
                taskCompletionContext: {
                    skillId: params.skillId,
                    intentMode: params.intentMode,
                    imageCount: Array.isArray(params.images) ? params.images.length : 0
                },
                toolDecisionContext: {
                    intentControlPlane: params.agentIntentControlPlane,
                    photoshopConnected: context?.isPluginConnected,
                    hasDocument: context?.photoshopContext?.hasDocument,
                    hasImageInput: Array.isArray(params.images) ? params.images.length > 0 : false
                },
                callbacks: agentCallbacks,
                callModelStream: callModelStreamViaIPC
            },
            callModelViaIPC,
            createExecuteToolWrapper(agentCallbacks, signal)
        );

        try {
            const result = await agent.run(userTask, params.images);
            if (result.cancelled) {
                return {
                    success: false,
                    message: '任务已取消。',
                    cancelled: true
                };
            }

            return {
                success: result.success,
                message: result.message,
                error: result.error,
                data: {
                    iterations: result.iterations,
                    stopReason: result.stopReason,
                    executionSummary: result.executionSummary,
                    toolCallLog: result.toolCallLog,
                    performanceBudget: runtimeBudget
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `智能体执行失败：${error.message}`,
                error: error.message
            };
        }
    }
};
