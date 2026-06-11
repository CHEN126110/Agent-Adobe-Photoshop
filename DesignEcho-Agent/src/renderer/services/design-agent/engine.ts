import { getSkillExecutor, executeSkillWithExecutor } from '../skill-executors';
import type { AgentContext, AgentResult, LightweightIntent, ProcessOptions } from '../agent-orchestration/types';
import {
    debugInferDecisionFromText,
    detectLightweightIntent,
    fastDeterministicRoute,
    getAgentMattingPausedMessage,
    inferSkillHint,
    isAgentPanelDebugIntent,
    isAgentMattingPaused,
    isDetailTemplateAuthoringIntent,
    isDocumentManagementIntent,
    isLayoutReplicationIntent,
    isMainImageTemplateAuthoringIntent,
    isMatteIntent,
    isRetryFeedbackIntent,
    isLocalFirstConversationalIntent,
    isModelFirstConversationalIntent,
    isSkuIntent,
    isSkillEnabled,
    normalizeSkillId
} from '../agent-orchestration/routing';
import {
    buildContextualConversationalFallbackReply,
    buildLocalConversationalReply,
    captureExplicitPreferenceFeedback,
    tryConversationalModelReply
} from '../agent-orchestration/conversational';
import { detectClarificationFollowupContext } from '../agent-orchestration/clarification-followup';
import { buildCurrentDocumentStructureRouteOptions } from '../agent-orchestration/document-structure-preflight';
import { classifyActionableIntent } from '../agent-orchestration/task-classifier';
import { toAgentImageAttachments } from '../../../shared/design-image-input';
import { applySharedSkillParamDefaults } from '../../../shared/skill-param-defaults';
import { getSkillById } from '../../../shared/skills/skill-declarations';
import {
    buildAgentRequestLifecycle,
    withAgentRequestLifecycle,
    type AgentRequestExecutionKind,
    type AgentRequestLifecycleEvidence,
    type AgentRequestRoute,
    type AgentRequestRouteSource
} from '../../../shared/agent-request-lifecycle';
import { buildAgentIntentDeliberationGate } from '../../../shared/agent-intent-deliberation-gate';
import {
    evaluateDeterministicRouteVeto,
    evaluateSimpleDeterministicRouteBoundary
} from '../../../shared/agent-route-boundary-policy';
import { buildAgentResumableTaskContract } from '../../../shared/agent-resumable-task-contract';
import { buildAgentResumeExecutionPolicy } from '../../../shared/agent-resume-execution-policy';
import { buildAgentResumeContextGate } from '../../../shared/agent-resume-context-gate';
import { buildAgentResumeContextRefreshRun } from '../../../shared/agent-resume-context-refresh-runner';
import { runAgentResumeReadonlyContextExecutor } from '../../../shared/agent-resume-readonly-context-executor';
import {
    buildAgentResumePlanningEvidence,
    buildAgentResumePlanningMessages
} from '../../../shared/agent-resume-planning';
import {
    buildAgentResumeExecutionGate,
    DEFAULT_AGENT_RESUME_WRITE_TOOL_ALLOWLIST
} from '../../../shared/agent-resume-execution-gate';
import {
    buildAgentResumeControlledExecutionRequest,
    runAgentResumeControlledExecutionRunner
} from '../../../shared/agent-resume-controlled-execution';
import {
    buildAgentIntentControlPlaneClarificationMessage,
    buildAgentIntentControlPlaneDecision,
    type AgentIntentControlPlaneDecision
} from '../../../shared/agent-intent-control-plane';
import {
    buildAgentTaskPlanningContract,
    type AgentTaskPlanningContract
} from '../../../shared/agent-task-planning-contract';
import {
    buildAgentDesignExecutionPreflight,
    shouldApplyAgentDesignExecutionPreflight,
    type AgentDesignExecutionPreflight
} from '../../../shared/agent-design-execution-preflight';
import {
    buildAgentTaskPublicPlanReadonlyContext,
    formatAgentTaskPublicPlanReadonlyContext,
    resolveProjectLabelForPublicPlan,
    type AgentTaskPublicPlanReadonlyContext
} from '../../../shared/agent-task-public-plan-readonly-context';
import {
    buildAgentTaskPublicPlanExecutionRequest,
    DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST
} from '../../../shared/agent-task-public-plan-execution-request';
import { buildAgentTaskPublicPlanApprovalRecord } from '../../../shared/agent-task-public-plan-approval-record';
import { runAgentTaskPublicPlanControlledRunner } from '../../../shared/agent-task-public-plan-controlled-runner';
import type {
    DesignIntelligenceAgentDecision,
    DesignIntelligenceWorkflowPhase,
    DesignIntelligenceWorkflowStep
} from '../../../shared/design-intelligence-plan';

function getUserFacingSkillMessage(skillId: string, fallback: string): string {
    const skill = getSkillById(skillId);
    if (!skill || skill.visibility !== 'user-facing') {
        return fallback;
    }
    return skill.name || fallback;
}

function isClearlyBrokenThinking(text?: string): boolean {
    const value = String(text || '').trim();
    if (!value) return true;
    if (/[?？]{3,}/.test(value)) return true;
    if (value.includes(String.fromCodePoint(0xFFFD))) return true;
    if (/^[?？.\s…!！,，:：;；-]+$/.test(value)) return true;
    return false;
}

function resolveModelThinking(modelThinking?: string): string {
    const trimmed = String(modelThinking || '').trim();
    if (!isClearlyBrokenThinking(trimmed)) {
        return trimmed;
    }
    return '';
}

function resolveIntentSummary(decision?: { intentSummary?: string; thinking?: string } | null): string {
    return resolveModelThinking(decision?.intentSummary || decision?.thinking);
}

function isStructuredRouterLikeText(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
    return /"route"\s*:/.test(trimmed) || /"skillId"\s*:/.test(trimmed);
}

function isToolCallLikeText(text: string): boolean {
    const value = String(text || '');
    return /<\s*tool_call\b/i.test(value)
        || /<\/\s*tool_call\s*>/i.test(value)
        || /<\s*function\s*=/i.test(value)
        || /<\/\s*function\s*>/i.test(value)
        || /\btool_use\b/i.test(value);
}

function parseJsonObjectBlock(text: string): Record<string, unknown> | null {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;

    try {
        const parsed = JSON.parse(candidate);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try {
            const parsed = JSON.parse(candidate.slice(start, end + 1));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : null;
        } catch {
            return null;
        }
    }
}

function emitIntentStatus(callbacks: ProcessOptions['callbacks'], intentSummary: string): void {
    const summary = intentSummary.trim();
    if (!summary) return;

    callbacks?.onThinking?.(summary, { source: 'model_visible_reasoning' });
    callbacks?.onStep?.({
        kind: 'model_response',
        title: '意图判断',
        detail: summary,
        status: 'success',
        percent: 18
    });
    callbacks?.onStatus?.(`意图判断：${summary}`);
}

async function requestInitialVisibleIntentPreview(
    context: AgentContext,
    callModel: NonNullable<ProcessOptions['callModel']>,
    callbacks: ProcessOptions['callbacks']
): Promise<boolean> {
    if (!callbacks?.onThinking) return false;

    const prompt = [
        '请输出一段给用户看的公开判断，用于说明你准备如何理解并处理这条 Photoshop 设计请求。',
        '要求：',
        '1. 使用简体中文，1 到 2 句。',
        '2. 只说明你对用户意图的理解、需要先确认的上下文、准备先做什么。',
        '3. 不要输出 JSON，不要列工具名，不要说已经完成。',
        '4. 不要暴露私有链式思维，不要编造已经读取到的 Photoshop 状态。',
        '',
        `用户请求：${context.userInput}`
    ].join('\n');

    try {
        const response = await callModel(
            [
                {
                    role: 'system',
                    content: [
                        'You are DesignEcho Agent.',
                        'Return only a short public, user-visible reasoning summary in Chinese.',
                        'Do not call tools. Do not output JSON. Do not reveal private chain-of-thought.'
                    ].join('\n')
                },
                { role: 'user', content: prompt }
            ],
            {
                temperature: 0.2,
                maxTokens: 180,
                purpose: 'visible_reasoning',
                stream: true
            }
        );
        const text = resolveModelThinking(response?.thinking || response?.text);
        if (text && !isStructuredRouterLikeText(text) && !isToolCallLikeText(text)) {
            callbacks.onThinking(text, { source: 'model_visible_reasoning' });
            return true;
        }
    } catch (error) {
        console.warn('[DesignAgentEngine] visible intent preview failed; continue with router:', error);
    }
    return false;
}

function cleanDecisionString(value: unknown): string | undefined {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text || undefined;
}

function cleanDecisionStrings(value: unknown, limit = 8): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map(cleanDecisionString).filter(Boolean) as string[])).slice(0, limit);
}

function pickObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function isDesignWorkflowPhase(value: unknown): value is DesignIntelligenceWorkflowPhase {
    return ['inspect', 'analyze', 'plan', 'retouch', 'compose', 'export', 'verify'].includes(String(value || ''));
}

function normalizeModelDesignWorkflow(value: unknown): DesignIntelligenceWorkflowStep[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item): DesignIntelligenceWorkflowStep | null => {
            const record = pickObject(item);
            const phase = record.phase;
            const goal = cleanDecisionString(record.goal);
            if (!isDesignWorkflowPhase(phase) || !goal) return null;
            return {
                phase,
                goal,
                allowedToolKinds: cleanDecisionStrings(record.allowedToolKinds, 8),
                requiredEvidence: cleanDecisionStrings(record.requiredEvidence, 8)
            };
        })
        .filter((item): item is DesignIntelligenceWorkflowStep => Boolean(item))
        .slice(0, 12);
}

function normalizeModelDesignDecisionPayload(value: unknown): DesignIntelligenceAgentDecision | null {
    const record = pickObject(value);
    const hierarchy = pickObject(record.hierarchy);
    const color = pickObject(record.color);
    const typography = pickObject(record.typography);
    const retouch = pickObject(record.retouch);
    const assetSelection = pickObject(record.assetSelection);
    const decision: DesignIntelligenceAgentDecision = {
        source: 'model-agent',
        designGoal: cleanDecisionString(record.designGoal),
        productUnderstanding: cleanDecisionStrings(record.productUnderstanding, 8),
        audience: cleanDecisionString(record.audience),
        hierarchy: {
            primarySubject: cleanDecisionString(hierarchy.primarySubject),
            focalPoint: cleanDecisionString(hierarchy.focalPoint),
            informationPriority: cleanDecisionStrings(hierarchy.informationPriority, 8),
            whitespaceIntent: cleanDecisionString(hierarchy.whitespaceIntent),
            layoutNotes: cleanDecisionStrings(hierarchy.layoutNotes, 8)
        },
        color: {
            paletteIntent: cleanDecisionString(color.paletteIntent),
            primaryColors: cleanDecisionStrings(color.primaryColors, 8),
            accentColors: cleanDecisionStrings(color.accentColors, 8),
            backgroundDirection: cleanDecisionString(color.backgroundDirection),
            contrastPlan: cleanDecisionString(color.contrastPlan),
            avoid: cleanDecisionStrings(color.avoid, 8)
        },
        typography: {
            tone: cleanDecisionString(typography.tone),
            hierarchy: cleanDecisionStrings(typography.hierarchy, 8),
            fontDirection: cleanDecisionString(typography.fontDirection),
            spacingDirection: cleanDecisionString(typography.spacingDirection),
            avoid: cleanDecisionStrings(typography.avoid, 8)
        },
        retouch: {
            objectives: cleanDecisionStrings(retouch.objectives, 8),
            colorCorrection: cleanDecisionString(retouch.colorCorrection),
            lighting: cleanDecisionString(retouch.lighting),
            cleanup: cleanDecisionStrings(retouch.cleanup, 8),
            fabricOrMaterialHandling: cleanDecisionString(retouch.fabricOrMaterialHandling),
            prohibitedEdits: cleanDecisionStrings(retouch.prohibitedEdits, 8)
        },
        assetSelection: {
            selectionPrinciples: cleanDecisionStrings(assetSelection.selectionPrinciples, 8),
            requiredEvidence: cleanDecisionStrings(assetSelection.requiredEvidence, 8),
            rejectRules: cleanDecisionStrings(assetSelection.rejectRules, 8)
        },
        toolWorkflow: normalizeModelDesignWorkflow(record.toolWorkflow),
        acceptanceCriteria: cleanDecisionStrings(record.acceptanceCriteria, 10),
        risks: cleanDecisionStrings(record.risks, 8),
        rationale: cleanDecisionStrings(record.rationale, 8)
    };

    const hasCoreDecision = Boolean(
        decision.designGoal
        && decision.productUnderstanding?.length
        && (decision.hierarchy?.primarySubject || decision.hierarchy?.informationPriority?.length)
        && (decision.color?.paletteIntent || decision.color?.primaryColors?.length)
        && (decision.typography?.tone || decision.typography?.hierarchy?.length)
        && (decision.retouch?.objectives?.length || decision.retouch?.colorCorrection)
        && (decision.assetSelection?.selectionPrinciples?.length || decision.assetSelection?.requiredEvidence?.length)
        && decision.toolWorkflow?.length
        && decision.acceptanceCriteria?.length
    );
    return hasCoreDecision ? decision : null;
}

function summarizeDesignPreflightProjectContext(context: AgentContext): string[] {
    const project = context.projectContext;
    return [
        `projectPath=${project?.projectPath || 'unknown'}`,
        `projectImageCount=${project?.projectImageCount ?? project?.assetIndex?.summary?.totalImages ?? 0}`,
        `selectedProjectImage=${project?.selectedProjectImageName || project?.selectedProjectImagePath || 'none'}`,
        `sampleImages=${(project?.sampleImagePaths || []).slice(0, 5).join(' | ') || 'none'}`,
        `visualInsightCount=${project?.visualInsightCache?.summary?.entriesWithInsight ?? 0}`
    ];
}

async function requestModelDesignIntelligenceDecision(
    context: AgentContext,
    input: {
        skillId: string;
        params: Record<string, any>;
        intentSummary?: string;
        routeSource: AgentRequestRouteSource;
    },
    callModel: NonNullable<ProcessOptions['callModel']>
): Promise<DesignIntelligenceAgentDecision | null> {
    const prompt = [
        '你是 DesignEcho 的设计规划 Agent。你只负责在执行 Photoshop 工具前给出公开、结构化、可审计的设计决策。',
        '不要调用工具，不要声称已经读取或修改 Photoshop，不要输出私有推理。',
        '只返回严格 JSON 对象，不要 Markdown。',
        '',
        '必须输出这些字段：',
        '{',
        '  "designGoal": string,',
        '  "productUnderstanding": string[],',
        '  "audience": string,',
        '  "hierarchy": { "primarySubject": string, "focalPoint": string, "informationPriority": string[], "whitespaceIntent": string, "layoutNotes": string[] },',
        '  "color": { "paletteIntent": string, "primaryColors": string[], "accentColors": string[], "backgroundDirection": string, "contrastPlan": string, "avoid": string[] },',
        '  "typography": { "tone": string, "hierarchy": string[], "fontDirection": string, "spacingDirection": string, "avoid": string[] },',
        '  "retouch": { "objectives": string[], "colorCorrection": string, "lighting": string, "cleanup": string[], "fabricOrMaterialHandling": string, "prohibitedEdits": string[] },',
        '  "assetSelection": { "selectionPrinciples": string[], "requiredEvidence": string[], "rejectRules": string[] },',
        '  "toolWorkflow": [{ "phase": "inspect|analyze|plan|retouch|compose|export|verify", "goal": string, "allowedToolKinds": string[], "requiredEvidence": string[] }],',
        '  "acceptanceCriteria": string[],',
        '  "risks": string[],',
        '  "rationale": string[]',
        '}',
        '',
        '约束：',
        '- 不要输出任何分数字段。',
        '- 不要把知识、偏好或网页信息变成直接 Photoshop 动作。',
        '- 配色、修图、排版和选图都必须说清楚依据和边界。',
        '- 如果视觉证据不足，也要明确 requiredEvidence，不要假装已经看过素材。',
        '',
        '当前请求：',
        `userInput=${context.userInput}`,
        `skillId=${input.skillId}`,
        `routeSource=${input.routeSource}`,
        input.intentSummary ? `intentSummary=${input.intentSummary}` : 'intentSummary=none',
        `skillParams=${JSON.stringify(input.params || {})}`,
        '',
        '项目上下文：',
        ...summarizeDesignPreflightProjectContext(context)
    ].join('\n');

    try {
        const result = await callModel(
            [
                {
                    role: 'system',
                    content: 'Return only strict JSON for a public design decision. Do not call tools.'
                },
                { role: 'user', content: prompt }
            ],
            {
                temperature: 0.2,
                maxTokens: 1200,
                purpose: 'design_execution_preflight',
                silent: true,
                stream: false
            }
        );
        return normalizeModelDesignDecisionPayload(parseJsonObjectBlock(String(result?.text || '')));
    } catch (error) {
        console.warn('[DesignAgentEngine] design execution preflight model decision failed:', error);
        return null;
    }
}

function buildAutonomousSkillParams(
    context: AgentContext,
    decision?: Awaited<ReturnType<typeof classifyActionableIntent>>,
    intentControlPlane?: AgentIntentControlPlaneDecision
): Record<string, any> {
    const images = Array.isArray(context.attachedImages) && context.attachedImages.length > 0
        ? toAgentImageAttachments(context.attachedImages)
        : context.attachedImageData
            ? [{ data: context.attachedImageData, mediaType: 'image/jpeg' as const }]
            : undefined;
    const decisionSkillParams = decision?.skillParams && typeof decision.skillParams === 'object'
        ? decision.skillParams
        : {};
    const decisionIntentSummary = resolveIntentSummary(decision);

    return {
        userTask: context.userInput,
        skillId: decision?.skillId || inferSkillHint(context.userInput),
        skillParams: decisionSkillParams,
        intentMode: decision?.mode,
        ...(intentControlPlane ? { agentIntentControlPlane: intentControlPlane } : {}),
        ...(decisionIntentSummary ? { recognizedIntent: decisionIntentSummary } : {}),
        images,
        ...(context.projectContext?.projectPath ? { projectPath: context.projectContext.projectPath } : {})
    };
}

function hasContextImageInput(context: AgentContext): boolean {
    return Boolean(context.hasAttachedImage)
        || Boolean(context.attachedImageData)
        || (Array.isArray(context.attachedImages) && context.attachedImages.length > 0);
}

function buildRetryDeterministicRoute(context: AgentContext) {
    if (!isRetryFeedbackIntent(context.userInput)) return null;

    const history = Array.isArray(context.conversationHistory) ? context.conversationHistory : [];
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const item = history[index];
        if (item?.role !== 'user') continue;
        const previousInput = String(item?.content || '').trim();
        if (!previousInput || isRetryFeedbackIntent(previousInput)) continue;

        const previousRoute = fastDeterministicRoute(previousInput);
        if (!previousRoute || previousRoute.skillId === 'agent-panel-bridge') continue;

        return {
            ...previousRoute,
            skillParams: {
                ...previousRoute.skillParams,
                retry: true,
                retryFeedback: context.userInput,
                previousUserIntent: previousInput
            },
            thinking: '复核上一条任务结果并重新执行。'
        };
    }

    return null;
}

function canExecuteSkillFromUserRequest(skillId: string, userInput: string): boolean {
    const skill = getSkillById(skillId);
    if (!skill) return false;
    if (skill.visibility === 'system-only') return false;
    if (skill.visibility === 'internal-debug') {
        return isAgentPanelDebugIntent(userInput);
    }
    return true;
}

function shouldExecuteDeterministicRouteBeforeRouterModel(
    deterministicRoute: ReturnType<typeof fastDeterministicRoute>,
    input: {
        hasVisibleModelReasoning: boolean;
        hasContextImage: boolean;
    }
): boolean {
    return evaluateSimpleDeterministicRouteBoundary({
        skillId: deterministicRoute?.skillId,
        hasVisibleModelReasoning: input.hasVisibleModelReasoning,
        hasContextImage: input.hasContextImage
    }).allowed;
}

function buildSkillUnavailableResult(skillId: string, userInput: string): AgentResult | null {
    if (!canExecuteSkillFromUserRequest(skillId, userInput)) {
        return {
            success: false,
            message: '这个请求当前不能直接从对话中执行，请改用对应面板或补充更明确的操作目标。',
            error: 'Skill not user-invocable'
        };
    }
    if (!isSkillEnabled(skillId)) {
        return {
            success: false,
            message: `${getUserFacingSkillMessage(skillId, '该能力')}当前已在设置中关闭。`,
            error: 'Skill disabled'
        };
    }
    if (!getSkillExecutor(skillId)) {
        return {
            success: false,
            message: '当前没有可用的处理器来完成这个请求。',
            error: 'Skill executor not found'
        };
    }
    return null;
}

function buildSkillParamsFromModelDecision(
    context: AgentContext,
    decision: Awaited<ReturnType<typeof classifyActionableIntent>>
): Record<string, any> {
    if (!decision?.skillId) return {};
    return applySharedSkillParamDefaults({
        skillId: decision.skillId,
        userInput: context.userInput,
        mode: decision.mode,
        params: decision.skillParams && typeof decision.skillParams === 'object'
            ? decision.skillParams
            : {}
    });
}

function buildLifecycle(
    context: AgentContext,
    input: {
        routeSource: AgentRequestRouteSource;
        route: AgentRequestRoute;
        skillId?: string;
        mode?: string;
        skillParams?: Record<string, unknown>;
        intentSummary?: string;
        reason?: string;
        executionKind?: AgentRequestExecutionKind;
        blockers?: string[];
        warnings?: string[];
        evidence?: Array<{ source: string; summary: string }>;
    }
): AgentRequestLifecycleEvidence {
    return buildAgentRequestLifecycle({
        userInput: context.userInput,
        context,
        ...input
    });
}

function attachLifecycle(
    result: AgentResult,
    lifecycle: AgentRequestLifecycleEvidence,
    intentControlPlane?: AgentIntentControlPlaneDecision
): AgentResult {
    const resultWithLifecycle = withAgentRequestLifecycle(result, lifecycle);
    const currentData = resultWithLifecycle.data && typeof resultWithLifecycle.data === 'object'
        ? resultWithLifecycle.data as Record<string, unknown>
        : {};
    const planning = buildAgentTaskPlanForLifecycle(lifecycle, intentControlPlane);

    return {
        ...resultWithLifecycle,
        data: {
            ...currentData,
            agentIntentControlPlane: planning.intentControlPlane,
            agentTaskPlan: planning.agentTaskPlan,
            agentIntentDeliberationGate: buildAgentIntentDeliberationGate({ lifecycle })
        }
    };
}

function buildAgentTaskPlanForLifecycle(
    lifecycle: AgentRequestLifecycleEvidence,
    intentControlPlane?: AgentIntentControlPlaneDecision
): {
    intentControlPlane: AgentIntentControlPlaneDecision;
    agentTaskPlan: AgentTaskPlanningContract;
} {
    const resolvedIntentControlPlane = intentControlPlane || buildAgentIntentControlPlaneDecision({
        userInput: lifecycle.request.rawText,
        hasImageInput: lifecycle.context.hasImageInput,
        hasDocument: lifecycle.context.hasDocument,
        photoshopConnected: lifecycle.context.photoshopConnected
    });

    return {
        intentControlPlane: resolvedIntentControlPlane,
        agentTaskPlan: buildAgentTaskPlanningContract({
            userInput: lifecycle.request.rawText,
            intentControlPlane: resolvedIntentControlPlane,
            lifecycle
        })
    };
}

function buildAgentTaskPlanBlockedMessage(agentTaskPlan: AgentTaskPlanningContract): string {
    if (agentTaskPlan.status === 'ready_for_model_planning') {
        return '这个请求需要先形成公开的设计计划、工具边界和验收目标，暂不进入 Photoshop 工具执行。';
    }
    if (agentTaskPlan.status === 'blocked_needs_clarification') {
        const clarificationDecision: AgentIntentControlPlaneDecision = {
            version: 'agent-intent-control-plane/v0',
            requestKind: agentTaskPlan.requestKind,
            toolScope: agentTaskPlan.allowedToolScope,
            shouldUseConversationalPath: false,
            allowsDeterministicRoute: false,
            allowsRouterModel: false,
            allowsAutonomousFallback: false,
            requiresClarificationBeforeTools: true,
            reason: agentTaskPlan.blockers.join('；') || '缺少明确执行信息。',
            userVisibleSummary: agentTaskPlan.designBrief.userVisibleSummary,
            matchedSignals: agentTaskPlan.blockers
        };
        return buildAgentIntentControlPlaneClarificationMessage(clarificationDecision);
    }
    return '这个请求当前不允许进入 Photoshop 工具执行。';
}

function buildAgentTaskPlanBlockedError(agentTaskPlan: AgentTaskPlanningContract): string {
    if (agentTaskPlan.status === 'ready_for_model_planning') return 'agent_task_plan_requires_model_planning';
    if (agentTaskPlan.status === 'blocked_needs_clarification') return 'agent_task_plan_requires_clarification';
    return 'agent_task_plan_blocks_tool_execution';
}

function shouldBlockExecutionByAgentTaskPlan(agentTaskPlan: AgentTaskPlanningContract): boolean {
    return agentTaskPlan.executionPlan.canExecuteTools !== true;
}

interface AgentTaskPublicPlan {
    status: 'ready';
    source: 'model';
    canExecuteTools: false;
    message: string;
    proposedWriteTools: string[];
    readbackTargets: string[];
    requiresUserConfirmation: true;
    executionPlanSummary?: string;
    requiredEvidence: string[];
    verificationTargets: string[];
    generatedAt: string;
}

function sanitizeAgentTaskPublicPlanDisplayText(value: unknown, maxLength = 1200): string {
    const text = String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/ig, '[binary-redacted]')
        .replace(/\b[A-Za-z]:[\\/][^\s;；,，]+/g, '[local-path-redacted]')
        .replace(/\s+\n/g, '\n')
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function normalizeAgentTaskPublicPlanStringList(value: unknown, limit = 12): string[] {
    if (!Array.isArray(value)) return [];
    const output: string[] = [];
    for (const item of value) {
        const text = sanitizeAgentTaskPublicPlanDisplayText(item, 80).replace(/\s+/g, ' ').trim();
        if (!text || output.includes(text)) continue;
        output.push(text);
        if (output.length >= limit) break;
    }
    return output;
}

function normalizeAgentTaskPublicPlanResponse(
    response: { text?: string; thinking?: string } | undefined
): Omit<AgentTaskPublicPlan, 'status' | 'source' | 'canExecuteTools' | 'requiredEvidence' | 'verificationTargets' | 'generatedAt'> | null {
    const text = resolveModelThinking(response?.text || response?.thinking);
    if (!text) return null;
    if (isToolCallLikeText(text)) return null;

    const parsed = parseJsonObjectBlock(text);
    if (parsed) {
        const message = sanitizeAgentTaskPublicPlanDisplayText(parsed.message);
        const proposedWriteTools = normalizeAgentTaskPublicPlanStringList(
            Array.isArray(parsed.proposedWriteTools)
                ? parsed.proposedWriteTools
                : parsed.writeToolAllowlist
        );
        const readbackTargets = normalizeAgentTaskPublicPlanStringList(parsed.readbackTargets);
        const executionPlanSummary = sanitizeAgentTaskPublicPlanDisplayText(parsed.executionPlanSummary, 240);
        if (!message) return null;
        return {
            message,
            proposedWriteTools,
            readbackTargets,
            requiresUserConfirmation: true,
            executionPlanSummary: executionPlanSummary || undefined
        };
    }

    if (isStructuredRouterLikeText(text)) return null;
    const message = sanitizeAgentTaskPublicPlanDisplayText(text);
    if (!message) return null;
    return {
        message,
        proposedWriteTools: [],
        readbackTargets: [],
        requiresUserConfirmation: true
    };
}

async function requestAgentTaskPublicPlan(
    context: AgentContext,
    agentTaskPlan: AgentTaskPlanningContract,
    lifecycle: AgentRequestLifecycleEvidence,
    readonlyContext: AgentTaskPublicPlanReadonlyContext,
    callModel: NonNullable<ProcessOptions['callModel']>,
    callbacks: ProcessOptions['callbacks']
): Promise<AgentTaskPublicPlan | null> {
    callbacks?.onStep?.({
        kind: 'model_request',
        title: '生成公开设计计划',
        detail: '先让模型给出用户可见的设计计划、工具边界和验收目标，本轮不进入 Photoshop 执行。',
        status: 'running',
        percent: 27
    });

    const prompt = [
        '请为 DesignEcho Agent 生成执行 Photoshop 工具前的公开设计计划和受控执行边界。',
        '这是计划，不是执行结果。',
        '只返回严格 JSON 对象，不要 Markdown。',
        '',
        'JSON 字段：',
        '{',
        '  "message": "给用户看的公开计划，简体中文，3 到 6 个短步骤，必须说明本轮尚未执行 Photoshop",',
        '  "writeToolAllowlist": ["后续如获用户确认，计划允许的 Photoshop 写工具名"],',
        '  "readbackTargets": ["每次写入后必须读回的证据目标，例如 layer_hierarchy 或 acceptance_snapshot"],',
        '  "requiresUserConfirmation": true,',
        '  "executionPlanSummary": "一句话说明受控执行计划，不包含本地路径或原始图片 payload"',
        '}',
        '',
        '硬性要求：',
        '1. message 可以展示给用户，但不要声称已经修改或导出任何内容。',
        '2. writeToolAllowlist 只列出确实需要的写工具；如果证据不足，返回空数组。',
        '3. readbackTargets 必须说明写入后如何读回验收；如果证据不足，返回空数组。',
        '4. 不要输出工具调用 XML，不要暴露私有链式思维。',
        '5. 不要输出分数、confidence、score 或没有依据的质量结论。',
        '',
        '用户请求：',
        context.userInput,
        '',
        '请求边界：',
        `route=${agentTaskPlan.route}`,
        `skillId=${agentTaskPlan.skillId || 'none'}`,
        `requestKind=${agentTaskPlan.requestKind}`,
        `allowedToolScope=${agentTaskPlan.allowedToolScope}`,
        `canExecuteTools=${agentTaskPlan.executionPlan.canExecuteTools}`,
        '',
        '计划需要覆盖的证据：',
        agentTaskPlan.requiredEvidence.join(', ') || 'none',
        '',
        '最低验收目标：',
        agentTaskPlan.executionPlan.verificationTargets.join(', ') || 'none',
        '',
        '当前上下文摘要：',
        `photoshopConnected=${lifecycle.context.photoshopConnected}`,
        `hasDocument=${lifecycle.context.hasDocument}`,
        `documentName=${lifecycle.context.documentName || 'unknown'}`,
        `hasProject=${lifecycle.context.hasProject}`,
        `projectLabel=${resolveProjectLabelForPublicPlan(context.projectContext as Record<string, unknown> | undefined)}`,
        '',
        '只读上下文摘要：',
        ...formatAgentTaskPublicPlanReadonlyContext(readonlyContext)
    ].join('\n');

    try {
        const response = await callModel(
            [
                {
                    role: 'system',
                    content: [
                        'You are DesignEcho Agent.',
                        'Return only strict JSON for a public user-visible design plan and controlled execution boundary.',
                        'Do not call tools. Do not reveal private chain-of-thought.'
                    ].join('\n')
                },
                { role: 'user', content: prompt }
            ],
            {
                temperature: 0.2,
                maxTokens: 700,
                purpose: 'agent_task_public_plan',
                stream: false
            }
        );
        const publicPlanPayload = normalizeAgentTaskPublicPlanResponse(response);
        if (!publicPlanPayload) {
            callbacks?.onStep?.({
                kind: 'model_response',
                title: '公开设计计划不可用',
                detail: '模型没有返回可直接展示的公开计划，保持工具执行阻断。',
                status: 'error',
                percent: 28,
                issue: 'agent_task_public_plan_unavailable'
            });
            return null;
        }
        callbacks?.onStep?.({
            kind: 'model_response',
            title: '公开设计计划',
            detail: publicPlanPayload.message,
            status: 'success',
            percent: 29
        });
        callbacks?.onStatus?.('已生成公开设计计划，尚未执行 Photoshop。');
        return {
            status: 'ready',
            source: 'model',
            canExecuteTools: false,
            message: publicPlanPayload.message,
            proposedWriteTools: publicPlanPayload.proposedWriteTools,
            readbackTargets: publicPlanPayload.readbackTargets,
            requiresUserConfirmation: true,
            executionPlanSummary: publicPlanPayload.executionPlanSummary,
            requiredEvidence: agentTaskPlan.requiredEvidence,
            verificationTargets: agentTaskPlan.executionPlan.verificationTargets,
            generatedAt: new Date().toISOString()
        };
    } catch (error) {
        console.warn('[DesignAgentEngine] agent task public plan failed:', error);
        callbacks?.onStep?.({
            kind: 'model_response',
            title: '公开设计计划生成失败',
            detail: '模型公开计划生成失败，保持工具执行阻断。',
            status: 'error',
            percent: 28,
            issue: 'agent_task_public_plan_failed'
        });
        return null;
    }
}

function buildAgentTaskPlanBlockedResult(
    agentTaskPlan: AgentTaskPlanningContract,
    callbacks: ProcessOptions['callbacks']
): AgentResult {
    const message = buildAgentTaskPlanBlockedMessage(agentTaskPlan);
    const error = buildAgentTaskPlanBlockedError(agentTaskPlan);
    callbacks?.onStep?.({
        kind: 'model_response',
        title: '执行前计划未放行',
        detail: message,
        status: 'error',
        percent: 26,
        issue: error
    });
    callbacks?.onStatus?.('需要先完成执行前计划。');
    return {
        success: false,
        message,
        error,
        data: {
            agentTaskPlan
        }
    };
}

function attachAgentDesignExecutionPreflight(
    result: AgentResult,
    preflight?: AgentDesignExecutionPreflight
): AgentResult {
    if (!preflight) return result;
    const currentData = result.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : {};
    return {
        ...result,
        data: {
            ...currentData,
            agentDesignExecutionPreflight: preflight
        }
    };
}

async function buildConversationalAgentResult(
    lightweightIntent: LightweightIntent,
    context: AgentContext,
    message: string,
    options?: {
        callModel?: NonNullable<ProcessOptions['callModel']>;
    }
): Promise<AgentResult> {
    if (lightweightIntent !== 'continuation') {
        return { success: true, message };
    }

    const agentResumableTaskContract = buildAgentResumableTaskContract({
        userInput: context.userInput,
        conversationHistory: context.conversationHistory
    });
    const agentResumeExecutionPolicy = buildAgentResumeExecutionPolicy(agentResumableTaskContract);
    const agentResumeContextGate = buildAgentResumeContextGate({
        policy: agentResumeExecutionPolicy,
        photoshopConnected: context.isPluginConnected,
        hasDocument: context.photoshopContext?.hasDocument,
        documentName: context.photoshopContext?.documentName,
        layerCount: context.photoshopContext?.layerCount,
        hasProject: Boolean(context.projectContext?.projectPath),
        projectPath: context.projectContext?.projectPath,
        hasFreshPhotoshopSnapshot: false,
        hasFreshProjectSnapshot: Boolean(context.projectContext?.contextSnapshot)
    });
    const initialRefreshRun = buildAgentResumeContextRefreshRun({
        gate: agentResumeContextGate
    });
    let agentResumeContextRefreshRun = initialRefreshRun;
    const agentResumeReadonlyContextExecutor = initialRefreshRun.canRequestReadOnlyRefresh
        ? await runAgentResumeReadonlyContextExecutor({
            refreshRun: initialRefreshRun,
            tools: context.resumeReadonlyToolHandlers
        })
        : undefined;

    if (agentResumeReadonlyContextExecutor?.status === 'completed_readonly_refresh') {
        agentResumeContextRefreshRun = buildAgentResumeContextRefreshRun({
            gate: agentResumeContextGate,
            evidence: agentResumeReadonlyContextExecutor.evidence
        });
    }

    let agentResumePlanning = buildAgentResumePlanningEvidence({
        contract: agentResumableTaskContract,
        policy: agentResumeExecutionPolicy,
        gate: agentResumeContextGate,
        refreshRun: agentResumeContextRefreshRun,
        readonlyExecutor: agentResumeReadonlyContextExecutor
    });

    if (agentResumePlanning.status === 'ready_for_model_resume_plan' && options?.callModel) {
        try {
            const modelResponse = await options.callModel(
                buildAgentResumePlanningMessages({
                    contract: agentResumableTaskContract,
                    policy: agentResumeExecutionPolicy,
                    gate: agentResumeContextGate,
                    refreshRun: agentResumeContextRefreshRun,
                    readonlyExecutor: agentResumeReadonlyContextExecutor
                }),
                {
                    temperature: 0.2,
                    maxTokens: 700,
                    stream: false,
                    purpose: 'resume_planning'
                }
            );
            const modelPlanText = String(modelResponse?.text || '').trim();
            agentResumePlanning = buildAgentResumePlanningEvidence({
                contract: agentResumableTaskContract,
                policy: agentResumeExecutionPolicy,
                gate: agentResumeContextGate,
                refreshRun: agentResumeContextRefreshRun,
                readonlyExecutor: agentResumeReadonlyContextExecutor,
                modelPlanText,
                modelError: modelPlanText ? undefined : new Error('模型未返回恢复计划文本。')
            });
        } catch (error) {
            agentResumePlanning = buildAgentResumePlanningEvidence({
                contract: agentResumableTaskContract,
                policy: agentResumeExecutionPolicy,
                gate: agentResumeContextGate,
                refreshRun: agentResumeContextRefreshRun,
                readonlyExecutor: agentResumeReadonlyContextExecutor,
                modelError: error
            });
        }
    }

    const agentResumeExecutionGate = buildAgentResumeExecutionGate({
        planning: agentResumePlanning,
        allowedWriteTools: [...DEFAULT_AGENT_RESUME_WRITE_TOOL_ALLOWLIST]
    });
    const agentResumeControlledExecutionRequest = buildAgentResumeControlledExecutionRequest({
        executionGate: agentResumeExecutionGate
    });
    const agentResumeControlledExecutionRunner = runAgentResumeControlledExecutionRunner({
        request: agentResumeControlledExecutionRequest
    });

    return {
        success: true,
        message,
        data: {
            agentResumableTaskContract,
            agentResumeExecutionPolicy,
            agentResumeContextGate,
            agentResumeContextRefreshRun,
            agentResumeReadonlyContextExecutor,
            agentResumePlanning,
            agentResumeExecutionGate,
            agentResumeControlledExecutionRequest,
            agentResumeControlledExecutionRunner
        }
    };
}

function buildModelDecisionLifecycle(
    context: AgentContext,
    decision: Awaited<ReturnType<typeof classifyActionableIntent>>,
    reason: string
): AgentRequestLifecycleEvidence {
    return buildLifecycle(context, {
        routeSource: 'model_router',
        route: decision?.route || 'autonomous_agent',
        skillId: decision?.skillId,
        mode: decision?.mode,
        skillParams: decision?.skillParams && typeof decision.skillParams === 'object'
            ? decision.skillParams as Record<string, unknown>
            : undefined,
        intentSummary: resolveIntentSummary(decision),
        reason
    });
}

function shouldDeterministicRouteVetoModelSkill(
    context: AgentContext,
    deterministicRoute: ReturnType<typeof fastDeterministicRoute>,
    decision: Awaited<ReturnType<typeof classifyActionableIntent>>
): boolean {
    if (!deterministicRoute?.skillId || !decision?.skillId) return false;

    const deterministicSkillId = deterministicRoute.skillId;
    const modelSkillId = normalizeSkillId(decision.skillId);
    if (!modelSkillId || deterministicSkillId === modelSkillId) return false;

    const userInput = context.userInput;
    return evaluateDeterministicRouteVeto({
        deterministicSkillId,
        modelSkillId,
        isRetryRoute: deterministicRoute.skillParams?.retry === true,
        isSkuIntent: isSkuIntent(userInput),
        isDocumentManagementIntent: isDocumentManagementIntent(userInput),
        isLayoutReplicationIntent: isLayoutReplicationIntent(userInput, { hasAttachedImage: hasContextImageInput(context) }),
        isDetailTemplateAuthoringIntent: isDetailTemplateAuthoringIntent(userInput),
        isMainImageTemplateAuthoringIntent: isMainImageTemplateAuthoringIntent(userInput)
    }).allowed;
}

function buildDesignPreflightBlockedMessage(preflight: AgentDesignExecutionPreflight): string {
    if (preflight.status === 'needs_model_design_decision') {
        return '这个任务需要先形成清晰的设计计划，再执行 Photoshop 写入。当前缺少模型或人工的设计决策。';
    }
    if (preflight.status === 'needs_visual_evidence') {
        return '这个任务需要先确认项目视觉素材和设计方向，再执行 Photoshop 写入。当前缺少项目视觉素材理解。';
    }
    return '这个任务的设计执行前检查未通过，已停止进入 Photoshop 写入。';
}

function buildDesignPreflightPassedMessage(preflight: AgentDesignExecutionPreflight): string {
    if (preflight.skillId === 'sku-batch' && !preflight.designIntelligencePlan) {
        return 'SKU 将使用专用执行计划确认项目 SKU 文档、模板、配置和导出读回，不要求通用视觉设计决策。';
    }
    return '已具备任务级设计计划和项目视觉素材理解，允许进入受控业务能力执行。';
}

function buildDesignPreflightProjectContext(context: AgentContext) {
    const projectContext = context.projectContext || {};
    const imageInputCount = hasContextImageInput(context) ? 1 : 0;
    const projectImageCount = Math.max(
        Number(projectContext.projectImageCount || 0),
        Number(projectContext.assetIndex?.summary?.totalImages || 0),
        Array.isArray(projectContext.sampleImagePaths) ? projectContext.sampleImagePaths.length : 0,
        imageInputCount
    );
    return {
        ...projectContext,
        projectImageCount,
        assetIndex: {
            ...projectContext.assetIndex,
            summary: {
                ...projectContext.assetIndex?.summary,
                totalImages: Number(projectContext.assetIndex?.summary?.totalImages || 0) || projectImageCount
            }
        }
    };
}

async function prepareAgentDesignExecutionPreflight(
    context: AgentContext,
    options: {
        skillId: string;
        params: Record<string, any>;
        routeSource: AgentRequestRouteSource;
        route?: AgentRequestRoute;
        mode?: string;
        intentSummary?: string;
        callModel?: ProcessOptions['callModel'];
        callbacks?: ProcessOptions['callbacks'];
    }
): Promise<{
    params: Record<string, any>;
    preflight?: AgentDesignExecutionPreflight;
    blockedResult?: AgentResult;
}> {
    if (!shouldApplyAgentDesignExecutionPreflight(options.skillId)) {
        return { params: options.params };
    }

    let params = options.params || {};
    let preflight = buildAgentDesignExecutionPreflight({
        userText: context.userInput,
        route: options.route || 'skill_execution',
        routeSource: options.routeSource,
        skillId: options.skillId,
        mode: options.mode,
        params,
        projectContext: buildDesignPreflightProjectContext(context)
    });

    if (preflight.status === 'needs_model_design_decision' && options.callModel) {
        options.callbacks?.onStep?.({
            kind: 'model_request',
            title: '设计执行前规划',
            detail: '请求模型先给出目标、层级、配色、修图、选图和验收标准，再决定是否进入业务能力执行。',
            status: 'running',
            percent: 30
        });
        const agentDecision = await requestModelDesignIntelligenceDecision(
            context,
            {
                skillId: options.skillId,
                params,
                intentSummary: options.intentSummary,
                routeSource: options.routeSource
            },
            options.callModel
        );
        if (agentDecision) {
            params = {
                ...params,
                designIntelligenceDecision: agentDecision
            };
            preflight = buildAgentDesignExecutionPreflight({
                userText: context.userInput,
                route: options.route || 'skill_execution',
                routeSource: options.routeSource,
                skillId: options.skillId,
                mode: options.mode,
                params,
                projectContext: buildDesignPreflightProjectContext(context),
                agentDecision
            });
        }
    }

    options.callbacks?.onStep?.({
        kind: preflight.shouldExecute ? 'tool_planned' : 'model_response',
        title: preflight.shouldExecute ? '设计执行前检查通过' : '设计执行前检查未通过',
        detail: preflight.shouldExecute
            ? buildDesignPreflightPassedMessage(preflight)
            : buildDesignPreflightBlockedMessage(preflight),
        status: preflight.shouldExecute ? 'success' : 'error',
        percent: preflight.shouldExecute ? 31 : 30,
        issue: preflight.shouldExecute ? undefined : preflight.status
    });

    if (!preflight.shouldExecute) {
        return {
            params,
            preflight,
            blockedResult: {
                success: false,
                message: buildDesignPreflightBlockedMessage(preflight),
                error: preflight.status,
                data: {
                    agentDesignExecutionPreflight: preflight
                }
            }
        };
    }

    return { params, preflight };
}

async function executeSkillWithLifecycle(
    context: AgentContext,
    options: {
        skillId: string;
        params: Record<string, any>;
        callbacks: ProcessOptions['callbacks'];
        signal: ProcessOptions['signal'];
        routeSource: AgentRequestRouteSource;
        route?: AgentRequestRoute;
        executionKind?: AgentRequestExecutionKind;
        mode?: string;
        intentSummary?: string;
        reason: string;
        agentDesignExecutionPreflight?: AgentDesignExecutionPreflight;
        intentControlPlane?: AgentIntentControlPlaneDecision;
        callModel?: ProcessOptions['callModel'];
    }
): Promise<AgentResult> {
    const lifecycle = buildLifecycle(context, {
        routeSource: options.routeSource,
        route: options.route || 'skill_execution',
        skillId: options.skillId,
        mode: options.mode,
        skillParams: options.params,
        intentSummary: options.intentSummary,
        reason: options.reason,
        executionKind: options.executionKind || 'deterministic_skill'
    });
    const planning = buildAgentTaskPlanForLifecycle(lifecycle, options.intentControlPlane);
    if (shouldBlockExecutionByAgentTaskPlan(planning.agentTaskPlan)) {
        if (planning.agentTaskPlan.status === 'ready_for_model_planning' && options.callModel) {
            const readonlyContext = await buildAgentTaskPublicPlanReadonlyContext({
                readonlyToolHandlers: context.resumeReadonlyToolHandlers
            });
            const publicPlan = await requestAgentTaskPublicPlan(
                context,
                planning.agentTaskPlan,
                lifecycle,
                readonlyContext,
                options.callModel,
                options.callbacks
            );
            if (publicPlan) {
                const publicPlanExecutionRequest = buildAgentTaskPublicPlanExecutionRequest({
                    agentTaskPlan: planning.agentTaskPlan,
                    publicPlan,
                    runtimeAllowedWriteTools: context.agentTaskPublicPlanApproval?.allowedWriteTools
                        || [...DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST],
                    userConfirmed: context.agentTaskPublicPlanApproval?.userConfirmed,
                    enableControlledExecutionRequest: context.agentTaskPublicPlanApproval?.enableControlledExecutionRequest,
                    requestId: context.agentTaskPublicPlanApproval?.requestId
                });
                return attachLifecycle(
                    {
                        success: true,
                        message: publicPlan.message,
                        data: {
                            agentTaskPlan: planning.agentTaskPlan,
                            agentTaskPublicPlan: publicPlan,
                            agentTaskPublicPlanReadonlyContext: readonlyContext,
                            agentTaskPublicPlanExecutionRequest: publicPlanExecutionRequest
                        }
                    },
                    lifecycle,
                    planning.intentControlPlane
                );
            }
        }
        return attachLifecycle(
            buildAgentTaskPlanBlockedResult(planning.agentTaskPlan, options.callbacks),
            lifecycle,
            planning.intentControlPlane
        );
    }
    const result = await executeSkillWithExecutor(options.skillId, {
        params: options.params,
        callbacks: options.callbacks,
        signal: options.signal,
        context
    });
    return attachAgentDesignExecutionPreflight(
        attachLifecycle(result, lifecycle),
        options.agentDesignExecutionPreflight
    );
}

async function executeSkillWithDesignPreflight(
    context: AgentContext,
    options: Parameters<typeof executeSkillWithLifecycle>[1] & {
        callModel?: ProcessOptions['callModel'];
        intentControlPlane?: AgentIntentControlPlaneDecision;
        mode?: string;
    }
): Promise<AgentResult> {
    const prepared = await prepareAgentDesignExecutionPreflight(context, {
        skillId: options.skillId,
        params: options.params,
        routeSource: options.routeSource,
        route: options.route || 'skill_execution',
        mode: options.mode,
        intentSummary: options.intentSummary,
        callModel: options.callModel,
        callbacks: options.callbacks
    });

    if (prepared.blockedResult) {
        return attachLifecycle(
            prepared.blockedResult,
            buildLifecycle(context, {
                routeSource: options.routeSource,
                route: options.route || 'skill_execution',
                skillId: options.skillId,
                mode: options.mode,
                skillParams: prepared.params,
                intentSummary: options.intentSummary,
                reason: `${options.reason} 任务级设计执行前检查未通过。`,
                executionKind: options.executionKind || 'deterministic_skill',
                blockers: prepared.preflight?.blockers,
                warnings: prepared.preflight?.warnings,
                evidence: [{
                    source: 'agent-design-execution-preflight',
                    summary: `status=${prepared.preflight?.status || 'unknown'}; skill=${options.skillId}`
                }]
            }),
            options.intentControlPlane
        );
    }

    return executeSkillWithLifecycle(context, {
        ...options,
        params: prepared.params,
        agentDesignExecutionPreflight: prepared.preflight
    });
}

export class DesignAgentEngine {
    async run(context: AgentContext, options: ProcessOptions): Promise<AgentResult> {
        const { callModel, callbacks, signal } = options;

        if (signal?.aborted) {
            callbacks?.onStep?.({
                kind: 'stopped',
                title: '任务已取消',
                status: 'error',
                issue: 'cancelled'
            });
            return attachLifecycle(
                { success: false, cancelled: true, message: '任务已取消。' },
                buildLifecycle(context, {
                    routeSource: 'system',
                    route: 'cancelled',
                    reason: '用户或系统取消了本次请求。'
                })
            );
        }

        if (isAgentMattingPaused() && isMatteIntent(context.userInput)) {
            const message = getAgentMattingPausedMessage();
            return attachLifecycle(
                {
                    success: false,
                    message,
                    error: 'Agent matting paused'
                },
                buildLifecycle(context, {
                    routeSource: 'system',
                    route: 'direct_response',
                    skillId: 'matte-product',
                    intentSummary: '用户请求抠图，但 Agent 对话端抠图入口已暂停。',
                    reason: '抠图质量和性能尚未完成验收，暂不允许 Agent 自动触发抠图工具。',
                    executionKind: 'none',
                    blockers: [message]
                })
            );
        }

        const publicPlanApprovalRecord = buildAgentTaskPublicPlanApprovalRecord({
            userInput: context.userInput,
            conversationHistory: context.conversationHistory as unknown as Array<Record<string, unknown>>,
            sourceMessageId: context.agentTaskPublicPlanApproval?.sourceMessageId
        });
        if (publicPlanApprovalRecord.requested) {
            const lifecycle = buildLifecycle(context, {
                routeSource: 'lightweight_intent',
                route: 'direct_response',
                intentSummary: '用户确认上一轮公开设计计划，系统只生成受控执行请求证据。',
                reason: '公开计划确认必须先落到可审计请求包，不能直接执行 Photoshop 写工具。',
                executionKind: 'none'
            });

            if (publicPlanApprovalRecord.status !== 'approved_controlled_execution_request') {
                return attachLifecycle(
                    {
                        success: false,
                        message: publicPlanApprovalRecord.blockers.join('；') || '没有可确认的公开计划请求。',
                        error: publicPlanApprovalRecord.status,
                        data: {
                            agentTaskPublicPlanApprovalRecord: publicPlanApprovalRecord
                        }
                    },
                    lifecycle
                );
            }

            const publicPlanExecutionRequest = buildAgentTaskPublicPlanExecutionRequest({
                agentTaskPlan: publicPlanApprovalRecord.agentTaskPlan,
                publicPlan: publicPlanApprovalRecord.agentTaskPublicPlan,
                runtimeAllowedWriteTools: context.agentTaskPublicPlanApproval?.allowedWriteTools
                    || publicPlanApprovalRecord.allowedWriteTools,
                userConfirmed: context.agentTaskPublicPlanApproval?.userConfirmed ?? publicPlanApprovalRecord.userConfirmed,
                enableControlledExecutionRequest: context.agentTaskPublicPlanApproval?.enableControlledExecutionRequest
                    ?? publicPlanApprovalRecord.enableControlledExecutionRequest,
                requestId: context.agentTaskPublicPlanApproval?.requestId || publicPlanApprovalRecord.requestId
            });
            const publicPlanControlledRun = runAgentTaskPublicPlanControlledRunner({
                request: publicPlanExecutionRequest
            });

            return attachLifecycle(
                {
                    success: true,
                    message: '已确认公开计划，并生成受控执行请求。当前仍未执行 Photoshop；下一步需要受控 runner 按白名单和读回目标执行。',
                    data: {
                        agentTaskPlan: publicPlanApprovalRecord.agentTaskPlan,
                        agentTaskPublicPlan: publicPlanApprovalRecord.agentTaskPublicPlan,
                        agentTaskPublicPlanApprovalRecord: publicPlanApprovalRecord,
                        agentTaskPublicPlanExecutionRequest: publicPlanExecutionRequest,
                        agentTaskPublicPlanControlledRun: publicPlanControlledRun
                    }
                },
                lifecycle
            );
        }

        const intentControlPlane = buildAgentIntentControlPlaneDecision({
            userInput: context.userInput,
            hasImageInput: hasContextImageInput(context),
            hasDocument: context.photoshopContext?.hasDocument,
            photoshopConnected: context.isPluginConnected
        });

        if (intentControlPlane.requiresClarificationBeforeTools) {
            const message = buildAgentIntentControlPlaneClarificationMessage(intentControlPlane);
            callbacks?.onStep?.({
                kind: 'model_response',
                title: '需要先澄清',
                detail: intentControlPlane.userVisibleSummary,
                status: 'success',
                percent: 12
            });
            callbacks?.onStatus?.('需要先明确目标后再执行。');
            return attachLifecycle(
                {
                    success: true,
                    message
                },
                buildLifecycle(context, {
                    routeSource: 'intent_control_plane',
                    route: 'clarification_needed',
                    intentSummary: intentControlPlane.userVisibleSummary,
                    reason: intentControlPlane.reason,
                    executionKind: 'none'
                }),
                intentControlPlane
            );
        }

        const clarificationFollowup = detectClarificationFollowupContext(context);
        if (clarificationFollowup) {
            callbacks?.onStep?.({
                kind: 'model_response',
                title: '承接澄清上下文',
                detail: '用户正在追问上一轮澄清要求，交给对话模型基于历史生成回答。',
                status: 'success',
                percent: 14
            });
            const conversationalReply = callModel
                ? await tryConversationalModelReply(context, callModel, { clarificationFollowup })
                : null;
            const message = conversationalReply || clarificationFollowup.previousClarification;

            return attachLifecycle(
                await buildConversationalAgentResult('chat', context, message, { callModel }),
                buildLifecycle(context, {
                    routeSource: 'lightweight_intent',
                    route: 'direct_response',
                    intentSummary: '用户在追问上一轮澄清要求，需要基于对话历史回答。',
                    reason: conversationalReply
                        ? '识别到澄清追问上下文，使用对话模型生成用户可读回答，未进入 Photoshop 执行链。'
                        : '识别到澄清追问上下文，但没有拿到有效模型回复，因此仅复用最近一条澄清内容，不进入 Photoshop 执行链。',
                    executionKind: 'none',
                    evidence: [{
                        source: 'conversation-history',
                        summary: 'recent_assistant_clarification_detected'
                    }]
                }),
                intentControlPlane
            );
        }

        const lightweightIntent = detectLightweightIntent(context.userInput);
        if (isModelFirstConversationalIntent(lightweightIntent)) {
            const conversationalRouteSource: AgentRequestRouteSource = intentControlPlane.requestKind === 'plan_only'
                ? 'intent_control_plane'
                : 'lightweight_intent';
            if (!callModel && isLocalFirstConversationalIntent(lightweightIntent)) {
                const localReply = buildLocalConversationalReply(lightweightIntent, context);
                if (localReply) {
                    return attachLifecycle(
                        await buildConversationalAgentResult(lightweightIntent, context, localReply, { callModel }),
                        buildLifecycle(context, {
                            routeSource: conversationalRouteSource,
                            route: 'direct_response',
                            intentSummary: '这是无需 Photoshop 执行的本地对话请求。',
                            reason: conversationalRouteSource === 'intent_control_plane'
                                ? intentControlPlane.reason
                                : `轻量意图识别为 ${lightweightIntent}，使用本地回复。`
                        }),
                        intentControlPlane
                    );
                }
            }

            const conversationalReply = callModel
                ? await tryConversationalModelReply(context, callModel)
                : null;
            if (conversationalReply) {
                return attachLifecycle(
                    await buildConversationalAgentResult(lightweightIntent, context, conversationalReply, { callModel }),
                    buildLifecycle(context, {
                        routeSource: conversationalRouteSource,
                        route: 'direct_response',
                        intentSummary: '这是无需 Photoshop 执行的模型对话请求。',
                        reason: conversationalRouteSource === 'intent_control_plane'
                            ? intentControlPlane.reason
                            : `轻量意图识别为 ${lightweightIntent}，交给对话模型回复。`
                    }),
                    intentControlPlane
                );
            }
            const localReply = buildLocalConversationalReply(lightweightIntent, context);
            if (localReply) {
                return attachLifecycle(
                    await buildConversationalAgentResult(lightweightIntent, context, localReply, { callModel }),
                    buildLifecycle(context, {
                        routeSource: conversationalRouteSource,
                        route: 'direct_response',
                        intentSummary: '这是无需 Photoshop 执行的本地对话请求。',
                        reason: conversationalRouteSource === 'intent_control_plane'
                            ? `${intentControlPlane.reason} 模型回复不可用后使用本地回复。`
                            : `轻量意图识别为 ${lightweightIntent}，模型回复不可用后使用本地回复。`
                    }),
                    intentControlPlane
                );
            }
            const contextualFallbackReply = buildContextualConversationalFallbackReply(lightweightIntent, context);
            if (contextualFallbackReply) {
                return attachLifecycle(
                    await buildConversationalAgentResult(lightweightIntent, context, contextualFallbackReply, { callModel }),
                    buildLifecycle(context, {
                        routeSource: conversationalRouteSource,
                        route: 'direct_response',
                        intentSummary: '这是无需 Photoshop 执行的能力说明请求。',
                        reason: conversationalRouteSource === 'intent_control_plane'
                            ? `${intentControlPlane.reason} 对话模型不可用或无有效回复后，基于当前技能注册表和项目上下文生成能力说明。`
                            : `轻量意图识别为 ${lightweightIntent}，对话模型不可用或无有效回复后，基于当前技能注册表和项目上下文生成能力说明。`
                    }),
                    intentControlPlane
                );
            }
            const unavailableMessage = callModel
                ? '对话模型没有返回有效内容，本次没有执行 Photoshop 工具。'
                : '当前没有可用对话模型，本次没有执行 Photoshop 工具。';
            return attachLifecycle(
                {
                    ...(await buildConversationalAgentResult(lightweightIntent, context, unavailableMessage, { callModel })),
                    success: false,
                    error: 'Conversational reply unavailable'
                },
                buildLifecycle(context, {
                    routeSource: conversationalRouteSource,
                    route: 'direct_response',
                    intentSummary: '这是无需 Photoshop 执行的对话请求，但没有得到有效对话回复。',
                    reason: conversationalRouteSource === 'intent_control_plane'
                        ? intentControlPlane.reason
                        : `轻量意图识别为 ${lightweightIntent}，没有得到有效对话回复，未触发执行链路。`
                }),
                intentControlPlane
            );
        }

        const visibleIntentPreviewEmitted = callModel
            ? await requestInitialVisibleIntentPreview(context, callModel, callbacks)
            : false;

        const documentStructureRouteOptions = await buildCurrentDocumentStructureRouteOptions(context);
        const deterministicRoute = buildRetryDeterministicRoute(context)
            || fastDeterministicRoute(context.userInput, {
                hasAttachedImage: hasContextImageInput(context),
                ...documentStructureRouteOptions
            });

        if (deterministicRoute
            && intentControlPlane.allowsDeterministicRoute
            && shouldExecuteDeterministicRouteBeforeRouterModel(deterministicRoute, {
            hasVisibleModelReasoning: visibleIntentPreviewEmitted,
            hasContextImage: hasContextImageInput(context)
        })) {
            const unavailable = buildSkillUnavailableResult(deterministicRoute.skillId, context.userInput);
            if (unavailable) {
                return attachLifecycle(
                    unavailable,
                    buildLifecycle(context, {
                        routeSource: 'deterministic_route',
                        route: 'skill_execution',
                        skillId: deterministicRoute.skillId,
                        intentSummary: deterministicRoute.thinking,
                        reason: '命中高确定性简单操作路由，但能力不可用。'
                    })
                );
            }

            callbacks?.onStep?.({
                kind: 'tool_planned',
                title: `选择能力：${deterministicRoute.skillId}`,
                detail: '已获得模型公开判断；命中高确定性简单 Photoshop 操作，跳过隐藏意图分类模型并直接执行。',
                status: 'success',
                percent: 24
            });
            callbacks?.onProgress?.('准备执行', 24);
            return executeSkillWithDesignPreflight(context, {
                skillId: deterministicRoute.skillId,
                params: deterministicRoute.skillParams,
                callbacks,
                signal,
                routeSource: 'deterministic_route',
                intentSummary: deterministicRoute.thinking,
                reason: '已获得模型公开判断；命中高确定性简单 Photoshop 操作，跳过隐藏意图分类模型并直接执行。',
                callModel,
                intentControlPlane
            });
        }

        let modelDecision: Awaited<ReturnType<typeof classifyActionableIntent>> = null;
        if (callModel && intentControlPlane.allowsRouterModel) {
            callbacks?.onStep?.({
                kind: 'model_request',
                title: '路由决策',
                detail: '调用意图分类模型判断是否需要 Photoshop 工具。',
                status: 'running',
                percent: 10
            });
            modelDecision = await classifyActionableIntent(context, callModel);
        }

        if (modelDecision?.route === 'direct_response' && modelDecision.directResponse) {
            if (callModel) {
                await captureExplicitPreferenceFeedback(context, modelDecision.directResponse, callModel);
            }
            return attachLifecycle(
                {
                    success: true,
                    message: modelDecision.directResponse
                },
                buildModelDecisionLifecycle(context, modelDecision, '模型路由判断为直接回复，不触发 Photoshop 执行。')
            );
        }

        if (modelDecision?.route === 'clarification_needed' && modelDecision.clarificationQuestion) {
            emitIntentStatus(callbacks, resolveIntentSummary(modelDecision));
            return attachLifecycle(
                {
                    success: true,
                    message: modelDecision.clarificationQuestion
                },
                buildModelDecisionLifecycle(context, modelDecision, '模型路由判断信息不足，先向用户澄清。')
            );
        }

        if (modelDecision?.route === 'skill_execution'
            && modelDecision.skillId
            && intentControlPlane.allowsDeterministicRoute
            && isSkillEnabled(modelDecision.skillId)
            && getSkillExecutor(modelDecision.skillId)
            && !shouldDeterministicRouteVetoModelSkill(context, deterministicRoute, modelDecision)) {
            if (!canExecuteSkillFromUserRequest(modelDecision.skillId, context.userInput)) {
                modelDecision = null;
            } else {
                emitIntentStatus(callbacks, resolveIntentSummary(modelDecision));
                callbacks?.onStep?.({
                    kind: 'tool_planned',
                    title: `选择能力：${modelDecision.skillId}`,
                    detail: '模型路由选择了可执行技能，且意图控制面允许进入受控执行。',
                    status: 'success',
                    percent: 28
                });
                callbacks?.onProgress?.('准备执行', 28);
                return executeSkillWithDesignPreflight(context, {
                    skillId: modelDecision.skillId,
                    params: buildSkillParamsFromModelDecision(context, modelDecision),
                    callbacks,
                    signal,
                    routeSource: 'model_router',
                    mode: modelDecision.mode,
                    intentSummary: resolveIntentSummary(modelDecision),
                    reason: deterministicRoute && deterministicRoute.skillId !== normalizeSkillId(modelDecision.skillId)
                        ? '模型路由选择了不同于确定性候选的技能；确定性路由未构成安全否决，仅作为 fallback。'
                        : '模型路由选择确定性技能，且意图控制面允许执行。',
                    callModel,
                    intentControlPlane
                });
            }
        }

        callbacks?.onProgress?.('分析需求', 12);
        if (deterministicRoute && intentControlPlane.allowsDeterministicRoute) {
            const unavailable = buildSkillUnavailableResult(deterministicRoute.skillId, context.userInput);
            if (unavailable) {
                return attachLifecycle(
                    unavailable,
                    buildLifecycle(context, {
                        routeSource: 'deterministic_route',
                        route: 'skill_execution',
                        skillId: deterministicRoute.skillId,
                        intentSummary: deterministicRoute.thinking,
                        reason: '命中确定性路由，但能力不可用。'
                    })
                );
            }

            callbacks?.onStep?.({
                kind: 'tool_planned',
                title: `选择能力：${deterministicRoute.skillId}`,
                detail: '命中确定性路由，直接执行对应能力。',
                status: 'success',
                percent: 28
            });
            callbacks?.onProgress?.('准备执行', 28);
            return executeSkillWithDesignPreflight(context, {
                skillId: deterministicRoute.skillId,
                params: deterministicRoute.skillParams,
                callbacks,
                signal,
                routeSource: 'deterministic_route',
                intentSummary: deterministicRoute.thinking,
                reason: '模型路由未覆盖时，使用确定性路由执行对应能力。',
                callModel,
                intentControlPlane
            });
        }

        if (modelDecision?.route === 'autonomous_agent'
            && intentControlPlane.allowsAutonomousFallback) {
            emitIntentStatus(callbacks, resolveIntentSummary(modelDecision));
            callbacks?.onStep?.({
                kind: 'tool_planned',
                title: '进入自主 Agent 执行',
                detail: '没有命中确定性技能，交给可调用工具的 Agent 循环处理。',
                status: 'success',
                percent: 20
            });
            callbacks?.onProgress?.('开始处理', 20);
            return executeSkillWithDesignPreflight(context, {
                skillId: 'autonomous-agent',
                params: buildAutonomousSkillParams(context, modelDecision, intentControlPlane),
                callbacks,
                signal,
                routeSource: 'model_router',
                route: 'autonomous_agent',
                executionKind: 'autonomous_agent',
                intentSummary: resolveIntentSummary(modelDecision),
                reason: '模型路由判断需要自主 Agent 工具循环。',
                callModel,
                intentControlPlane
            });
        }

        emitIntentStatus(callbacks, resolveIntentSummary(modelDecision));
        const clarificationMessage = buildAgentIntentControlPlaneClarificationMessage(intentControlPlane);
        callbacks?.onStep?.({
            kind: 'model_response',
            title: '无法安全执行',
            detail: intentControlPlane.allowsAutonomousFallback
                ? '开放式执行请求缺少模型明确放行，先澄清而不是默认进入工具循环。'
                : intentControlPlane.userVisibleSummary,
            status: 'success',
            percent: 20
        });
        callbacks?.onStatus?.('需要先明确或重新确认执行意图。');

        return attachLifecycle(
            {
                success: true,
                message: clarificationMessage
            },
            buildLifecycle(context, {
                routeSource: 'intent_control_plane',
                route: 'clarification_needed',
                intentSummary: resolveIntentSummary(modelDecision) || intentControlPlane.userVisibleSummary,
                reason: modelDecision
                    ? `${intentControlPlane.reason} 模型路由未达到允许执行的条件，不能回退到自主 Agent。`
                    : `${intentControlPlane.reason} 没有可用模型路由结果，不能默认进入自主 Agent。`,
                executionKind: 'none'
            }),
            intentControlPlane
        );
    }

    debugDecisionFromText(userInput: string) {
        return debugInferDecisionFromText(userInput);
    }
}

export const designAgentEngine = new DesignAgentEngine();

export async function processWithUnifiedAgent(
    context: AgentContext,
    options: ProcessOptions
): Promise<AgentResult> {
    return designAgentEngine.run(context, options);
}

export { debugInferDecisionFromText };
