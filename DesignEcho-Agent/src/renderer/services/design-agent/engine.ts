import { getSkillExecutor, executeSkillWithExecutor } from '../skill-executors';
import { executeSkillTool } from '../skill-executors/skill-tools';
import { resolveBareContinuationResumeDecision } from '../../../shared/agent-bare-continuation-resume';
import { buildRunRecordResumeBrief } from '../../../shared/agent-run-resume';
import type {
    AgentContext,
    AgentResult,
    AgentUserVisibleNotice,
    LightweightIntent,
    ProcessOptions
} from '../agent-orchestration/types';
import {
    debugInferDecisionFromText,
    detectLightweightIntent,
    fastDeterministicRoute,
    isAgentPanelDebugIntent,
    isDetailTemplateAuthoringIntent,
    isDocumentManagementIntent,
    isLayoutReplicationIntent,
    isMainImageDesignIntent,
    isMainImageTemplateAuthoringIntent,
    isRetryFeedbackIntent,
    isModelFirstConversationalIntent,
    isSkillEnabled,
    isTemplateSaveIntent,
    normalizeSkillId
} from '../agent-orchestration/routing';
import {
    buildLocalConversationalReply,
    captureExplicitPreferenceFeedback,
    tryConversationalModelReplyDetailed,
    type ConversationalModelFailure,
    type ConversationalModelFailureKind,
    type ConversationalModelReplyDetailedResult
} from '../agent-orchestration/conversational';
import {
    sanitizeUserVisibleAssistantBodyText,
    sanitizeUserVisibleThinkingText
} from '../../../shared/chat-response-cleaner';
import { detectClarificationFollowupContext } from '../agent-orchestration/clarification-followup';
import { getPhotoshopContext } from '../agent-orchestration/context';
import { toAgentImageAttachments } from '../../../shared/design-image-input';
import { applySharedSkillParamDefaults } from '../../../shared/skill-param-defaults';
import {
    buildRuntimeSelectedSkillHandoffFromUserSelection,
    buildSkillRoutingRecommendation,
    type FindSkillRoutingIntentOptions
} from '../../../shared/skill-routing';
import {
    getSkillById,
    isControlledRouteAutonomousEntrySkill
} from '../../../shared/skills/skill-declarations';
import type { RuntimeSelectedSkillHandoff } from '../../../shared/agent-runtime-v5/runtime-selected-skill-handoff';
import { buildAgentOperatingProfilePromptSection } from '../../../shared/agent-runtime-v5/agent-operating-profile';
import {
    compileOperatingContextPrompt,
    resolveOperatingPhotoshopConnection,
    resolveOperatingPhotoshopDocumentPresence
} from '../../../shared/agent-runtime-v5/operating-context-snapshot';
import {
    buildAgentRequestLifecycle,
    withAgentRequestLifecycle,
    type AgentRequestExecutionKind,
    type AgentRequestLifecycleRecord,
    type AgentRequestRoute,
    type AgentRequestRouteSource
} from '../../../shared/agent-request-lifecycle';
import {
    isCoordinatorWorkflowShortPathSkill,
    isMetadataOnlyProjectInventoryRoute,
    shouldEnterConversationalRoute
} from '../../../shared/agent-route-boundary-policy';
import { buildAgentResumableTaskContract } from '../../../shared/agent-resumable-task-contract';
import { buildAgentResumeExecutionPolicy } from '../../../shared/agent-resume-execution-policy';
import { buildAgentResumeContextGate, buildAgentResumeContextRefreshRun, runAgentResumeReadonlyContextExecutor } from '../../../shared/agent-resume-context-pipeline';
import {
    buildAgentResumePlanningResult,
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
    buildAgentIntentControlPlaneDecision,
    buildAutonomousExecutionDecisionForEngine,
    extractExplicitUserCapabilityConstraint,
    isConfirmedToolRequiredIntent,
    isAgentSkillCapabilityQuestion,
    type AgentCapabilityConstraint,
    type AgentIntentControlPlaneDecision
} from '../../../shared/agent-intent-control-plane';
import { applyExplicitAgentCapabilityCeiling } from '../../../shared/agent-semantic-intent-contract';
import {
    buildAgentTaskPlanningContract,
    type AgentTaskProgressObligation,
    type AgentTaskPlanningContract
} from '../../../shared/agent-task-planning-contract';
import { resolveAgentTaskProgressIdentity } from '../../../shared/agent-task-progress-identity';
import {
    buildAgentUserVisibleState,
    getInternalAgentStatusPublicMessage
} from '../../../shared/agent-user-visible-state';
import {
    capabilityBlocksExecution,
    resolveDeclaredCapabilityVerdict
} from '../../../shared/model-capability-verdict';
import {
    buildConversationalUnavailableMessage,
    type ConversationalProviderFailureKind
} from '../../../shared/conversational-unavailable-message';
import {
    type InteractiveContinuationMutationState
} from '../../../shared/interactive-continuation-operation';
import {
    resolvePendingInteractiveContinuationPauseRevision,
    resolveInteractiveContinuationOperationRequest
} from '../../../shared/pending-interactive-continuation';
import {
    resolveAgentInternalResumeRequest
} from '../../../shared/interactive-review-resume';
import {
    getInteractiveContinuationOperation,
    settleInteractiveContinuationOperation
} from '../interactive-continuation-operation-client';
import {
    deterministicBlockerReplyOrigin,
    modelAuthoredReplyOrigin,
    modelRepairedReplyOrigin,
    toolSummaryReplyOrigin,
    uiStatusReplyOrigin,
    type AssistantReplyOrigin
} from '../../../shared/assistant-reply-origin';
import {
    buildModelMediatedSkillReplyMessages,
    requiresModelMediatedUserReply
} from '../../../shared/agent-user-reply-mediation-policy';

/**
 * GATE-SIMPLIFY-007：查询同会话分支是否存在可续接的未完成运行档案。
 * 只有「同会话分支 + 未完成 + 未过期」才返回 true；查询失败/桥缺失一律 false（安全侧降级）。
 */
async function resolveBareContinuationResumableRecord(input: {
    conversationId?: string;
    conversationBranchId?: string;
    projectPath?: string;
}): Promise<boolean> {
    const conversationId = String(input.conversationId || '').trim();
    const conversationBranchId = String(input.conversationBranchId || '').trim();
    const projectPath = String(input.projectPath || '').trim();
    if (!conversationId || !conversationBranchId || !projectPath) return false;
    const listBridge = (window as any)?.designEcho?.listAgentRunRecords;
    if (typeof listBridge !== 'function') return false;
    try {
        const listed = await listBridge(projectPath, 5);
        const brief = buildRunRecordResumeBrief({
            records: Array.isArray(listed?.records) ? listed.records : [],
            nowMs: Date.now(),
            conversationScope: { conversationId, branchId: conversationBranchId }
        });
        return brief.applicable === true;
    } catch {
        return false;
    }
}
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
    DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST,
    type AgentTaskPublicPlanControlledOperationRequest,
    type AgentTaskPublicPlanExecutionRequest
} from '../../../shared/agent-task-public-plan-execution-request';
import {
    buildAgentTaskPublicPlanApprovalRecord,
    isPublicPlanConfirmationInput
} from '../../../shared/agent-task-public-plan-approval-record';
import {
    classifyAgentToolExecution,
    resolveAuthorizedExactPropertyReplacementExecutionScope
} from '../../../shared/agent-tool-execution-preflight';
import type { RuntimeInteractiveReentry } from '../../../shared/agent-runtime-v5/runtime-interactive-reentry';
import { extractModelJsonObject } from '../../../shared/model-json-extract';
import {
    collectAgentTaskPublicPlanOperationParamBlockers,
    runAgentTaskPublicPlanControlledRunnerAsync,
    type AgentTaskPublicPlanControlledRun
} from '../../../shared/agent-task-public-plan-controlled-runner';
import {
    buildAgentReActObservationFromPublicPlanRun,
    buildAgentReActObservationFromSkillResult,
    type AgentReActObservation
} from '../../../shared/agent-react-observation-contract';
import {
    buildRuntimeInteractivePhotoshopObservation,
    prepareRuntimeInteractiveResume
} from './interactive-continuation-reentry-controller';
import { runRuntimeInteractiveContinuation } from './interactive-continuation-reentry-runner';
import {
    buildDesignIntelligenceProjectContextSummary,
    type DesignIntelligenceAgentDecision,
    type DesignIntelligenceWorkflowPhase,
    type DesignIntelligenceWorkflowStep
} from '../../../shared/design-intelligence-plan';
import { buildProjectDesignUnderstandingSummary } from '../../../shared/project-design-understanding-summary';


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

function extractModelVisibleText(response: unknown): string {
    if (typeof response === 'string') {
        return resolveModelThinking(response);
    }
    if (!response || typeof response !== 'object') return '';
    const record = response as Record<string, unknown>;
    // Provider thinking is never a user-visible body fallback. If the Provider did not return
    // final content, the caller must report an empty-response failure instead of publishing
    // private reasoning as the skill result.
    for (const key of ['text', 'message', 'content']) {
        const value = record[key];
        if (typeof value !== 'string') continue;
        const text = resolveModelThinking(value);
        if (text) return text;
    }
    return '';
}

function resolveIntentSummary(decision?: { intentSummary?: string; thinking?: string } | null): string {
    return resolveModelThinking(decision?.intentSummary || decision?.thinking);
}

function resolveConversationalUnavailableMessage(
    intent: LightweightIntent,
    context: AgentContext,
    kind: ConversationalProviderFailureKind = 'unknown',
    failedModelLabel?: string
): string {
    const audience = intent === 'capability' || isAgentSkillCapabilityQuestion(context.userInput)
        ? 'capability'
        : 'general';
    return buildConversationalUnavailableMessage({ audience, kind, ...(failedModelLabel ? { failedModelLabel } : {}) });
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
    const extracted = extractModelJsonObject(text);
    const value = extracted?.value;
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function emitIntentStatus(callbacks: ProcessOptions['callbacks'], intentSummary: string): void {
    const summary = sanitizeUserVisibleThinkingText(intentSummary).trim();
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
        const text = sanitizeUserVisibleThinkingText(resolveModelThinking(response?.text || ''));
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
                requiredInputs: cleanDecisionStrings(record.requiredInputs, 8)
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
            requiredInputs: cleanDecisionStrings(assetSelection.requiredInputs, 8),
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
        && (decision.assetSelection?.selectionPrinciples?.length || decision.assetSelection?.requiredInputs?.length)
        && decision.toolWorkflow?.length
        && decision.acceptanceCriteria?.length
    );
    return hasCoreDecision ? decision : null;
}

function summarizeDesignPreflightProjectContext(context: AgentContext): string[] {
    const project = context.projectContext;
    const projectContextSummary = buildDesignIntelligenceProjectContextSummary({
        ...project,
        attachmentImageCount: countContextImageInputs(context)
    });
    const assetAvailability = projectContextSummary.assetAvailability;
    const visualUnderstanding = projectContextSummary.visualUnderstanding;
    const productUnderstanding = buildProjectDesignUnderstandingSummary({
        projectContext: project
    });
    return [
        ...(!context.operatingContextSnapshot ? [
            `projectPath=${project?.projectPath || 'unknown'}`,
            `selectedProjectImage=${project?.selectedProjectImageName || project?.selectedProjectImagePath || 'none'}`
        ] : []),
        `availableProjectImages=${assetAvailability.availableImageCount}`,
        `indexedProjectImages=${assetAvailability.indexedImageCount}`,
        `attachedImages=${assetAvailability.attachmentImageCount}`,
        `sampleImages=${(project?.sampleImagePaths || []).slice(0, 5).join(' | ') || 'none'}`,
        `concreteVisualUnderstanding=${visualUnderstanding.concreteInsightCount}`,
        `reportedVisualInsightCount=${visualUnderstanding.reportedInsightCount} (metadata only)`,
        ...productUnderstanding.lines
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
        '  "assetSelection": { "selectionPrinciples": string[], "requiredInputs": string[], "rejectRules": string[] },',
        '  "toolWorkflow": [{ "phase": "inspect|analyze|plan|retouch|compose|export|verify", "goal": string, "allowedToolKinds": string[], "requiredInputs": string[] }],',
        '  "acceptanceCriteria": string[],',
        '  "risks": string[],',
        '  "rationale": string[]',
        '}',
        '',
        '约束：',
        '- 不要输出任何分数字段。',
        '- 不要把知识、偏好或网页信息变成直接 Photoshop 动作。',
        '- 配色、修图、排版和选图都必须说清楚依据和边界。',
        '- 如果视觉观察不足，也要明确 requiredInputs，不要假装已经看过素材。',
        '',
        '当前请求：',
        `userInput=${context.userInput}`,
        `skillId=${input.skillId}`,
        `routeSource=${input.routeSource}`,
        input.intentSummary ? `intentSummary=${input.intentSummary}` : 'intentSummary=none',
        `skillParams=${JSON.stringify(input.params || {})}`,
        '',
        ...(context.operatingContextSnapshot ? [
            '本轮提交情境：',
            compileOperatingContextPrompt(context.operatingContextSnapshot),
            ''
        ] : []),
        '项目上下文：',
        ...summarizeDesignPreflightProjectContext(context)
    ].join('\n');

    try {
        const result = await callModel(
            [
                {
                    role: 'system',
                    content: [
                        buildAgentOperatingProfilePromptSection(),
                        'Return only strict JSON for a public design decision. Do not call tools.'
                    ].join('\n')
                },
                { role: 'user', content: prompt }
            ],
            {
                temperature: 0.2,
                // 设计决策 JSON 含 9 类嵌套字段，1200 tokens 必然截断（截断 → 解析失败 → 执行被拦），
                // 按完整结构所需上调
                maxTokens: 3200,
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

export function buildAutonomousSkillParams(
    context: AgentContext,
    intentControlPlane?: AgentIntentControlPlaneDecision,
    runtimeSelectedSkillHandoff?: RuntimeSelectedSkillHandoff,
    capabilityConstraint?: AgentCapabilityConstraint
): Record<string, any> {
    const images = Array.isArray(context.attachedImages) && context.attachedImages.length > 0
        ? toAgentImageAttachments(context.attachedImages)
        : context.attachedImageData
            ? [{ data: context.attachedImageData, mediaType: 'image/jpeg' as const }]
            : undefined;
    const explicitCapabilityConstraint = capabilityConstraint
        || extractExplicitUserCapabilityConstraint(context.userInput);
    // 普通自然语言仍进入通用 Agent。Harness 只采信显式能力上限，以及上游形成的
    // selection-only Runtime handoff；advisory recommendation 本身不会补造 Skill 身份或权限。
    const skillBridgesForbidden = explicitCapabilityConstraint.skillBridgePolicy === 'forbid';
    const resolvedCapabilityConstraint: AgentCapabilityConstraint = {
        ...explicitCapabilityConstraint,
        source: 'explicit_user_instruction',
        skillBridgePolicy: skillBridgesForbidden ? 'forbid' : 'allow',
        deniedCapabilityKinds: skillBridgesForbidden ? ['skill'] : [],
        matchedSignals: [...explicitCapabilityConstraint.matchedSignals]
    };
    // 只有带 provenance 的结构化 handoff 能声明 Runtime Skill 身份。
    const declaredSkillId = runtimeSelectedSkillHandoff?.skillId;
    const governedDeclaredSkillId = skillBridgesForbidden ? undefined : declaredSkillId;
    const hasCapabilityConstraint = resolvedCapabilityConstraint.matchedSignals.length > 0
        || resolvedCapabilityConstraint.deniedCapabilityKinds.length > 0
        || resolvedCapabilityConstraint.deniedProviderToolNames.length > 0
        || resolvedCapabilityConstraint.deniedToolDomains.length > 0
        || Boolean(resolvedCapabilityConstraint.toolScopeCeiling);
    // 精确、单一属性修改属于“有唯一正确答案”的确定性边界。这里复用既有请求级
    // runtimeAllowedWriteTools，把用户给出的 mutation 上限同时投影到候选能力面和最终
    // Tool 执行点；任务类型、Manifest 或模型后续声明都不能把它扩大成整图创作。
    // 复合写入 / 保存 / 导出请求不会命中该局部范围，继续交由完整计划处理。
    const exactPropertyExecutionScope = resolveAuthorizedExactPropertyReplacementExecutionScope({
        userRequest: context.userInput,
        toolScope: intentControlPlane?.toolScope,
        executionAuthorization: intentControlPlane?.executionAuthorization
    });
    const skillRoutingRecommendation = skillBridgesForbidden
        ? undefined
        : buildSkillRoutingRecommendation(context.userInput, {
            includeVisibilities: ['user-facing'],
            includeRouteClasses: ['business-workflow'],
            modelDirectExecution: 'forbidden'
        });

    return {
        userTask: context.userInput,
        // 只有带 provenance 的 handoff / R0 声明能驱动运行期身份与 manifest。
        ...(governedDeclaredSkillId ? { declaredSkillId: governedDeclaredSkillId } : {}),
        ...(!skillBridgesForbidden && runtimeSelectedSkillHandoff ? { runtimeSelectedSkillHandoff } : {}),
        ...(skillBridgesForbidden ? { skillBridgePolicy: 'forbid' } : {}),
        ...(hasCapabilityConstraint ? { agentCapabilityConstraint: resolvedCapabilityConstraint } : {}),
        ...(intentControlPlane ? { agentIntentControlPlane: intentControlPlane } : {}),
        ...(skillRoutingRecommendation ? { skillRoutingRecommendation } : {}),
        ...(context.providerNativeWebSearchIntent ? { providerNativeWebSearchIntent: context.providerNativeWebSearchIntent } : {}),
        ...(context.selectedModelId ? { primaryModelId: context.selectedModelId } : {}),
        ...(typeof context.selectedModelThinkingEnabled === 'boolean'
            ? { primaryModelThinkingEnabled: context.selectedModelThinkingEnabled }
            : {}),
        ...(exactPropertyExecutionScope ? {
            runtimeAllowedWriteTools: exactPropertyExecutionScope.allowedWriteTools,
            runtimeExactPropertyScope: exactPropertyExecutionScope
        } : {}),
        ...(context.currentUserContentParts?.length ? {
            initialUserContentParts: context.currentUserContentParts
        } : {}),
        images,
        ...(context.projectContext?.projectPath ? { projectPath: context.projectContext.projectPath } : {})
    };
}

function hasContextImageInput(context: AgentContext): boolean {
    return Boolean(context.hasAttachedImage)
        || Boolean(context.attachedImageData)
        || (Array.isArray(context.attachedImages) && context.attachedImages.length > 0);
}

function countContextImageInputs(context: AgentContext): number {
    const structuredImageCount = Array.isArray(context.attachedImages)
        ? context.attachedImages.length
        : 0;
    return Math.max(structuredImageCount, hasContextImageInput(context) ? 1 : 0);
}

function buildRetryDeterministicRoute(context: AgentContext) {
    if (!isRetryFeedbackIntent(context.userInput)) return null;

    const history = Array.isArray(context.conversationHistory) ? context.conversationHistory : [];
    let latestAssistantIndex = -1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
        if (history[index]?.role === 'assistant') {
            latestAssistantIndex = index;
            break;
        }
    }
    if (latestAssistantIndex < 0) return null;
    const latestAssistant = history[latestAssistantIndex];
    const executionSummary = latestAssistant?.executionSummary;
    const summary = executionSummary && typeof executionSummary === 'object'
        ? executionSummary as Record<string, unknown>
        : undefined;
    const summaryStatus = String(
        summary?.status || summary?.executionStatus || summary?.stopReason || ''
    ).trim().toLowerCase();
    if (!/(failed|error|needs_review|partial|incomplete|未完成|失败)/i.test(summaryStatus)) {
        return null;
    }
    const lifecycleValue = latestAssistant?.agentRequestLifecycle;
    const lifecycle = lifecycleValue && typeof lifecycleValue === 'object'
        ? lifecycleValue as Record<string, any>
        : undefined;
    const lifecycleSkillId = normalizeSkillId(lifecycle?.decision?.skillId);
    for (let index = latestAssistantIndex - 1; index >= 0; index -= 1) {
        const item = history[index];
        if (item?.role === 'assistant') break;
        if (item?.role !== 'user') continue;
        const previousInput = String(item?.content || '').trim();
        if (!previousInput || isRetryFeedbackIntent(previousInput)) return null;
        const previousRoute = fastDeterministicRoute(previousInput);
        if (!previousRoute || previousRoute.skillId === 'agent-panel-bridge') return null;
        if (lifecycleSkillId && normalizeSkillId(previousRoute.skillId) !== lifecycleSkillId) return null;
        return {
            ...previousRoute,
            skillParams: {
                ...previousRoute.skillParams,
                retry: true,
                retryFeedback: context.userInput,
                previousUserIntent: previousInput
            },
            thinking: '复核紧邻失败任务的结果并重新执行。'
        };
    }
    return null;
}

function buildReadOnlyInspectFallbackRoute(
    context: AgentContext,
    intentControlPlane: AgentIntentControlPlaneDecision
): ReturnType<typeof fastDeterministicRoute> {
    if (intentControlPlane.requestKind !== 'read_only_inspect') return null;
    const sourceType = hasContextImageInput(context) ? 'attached_image' : 'active_document';
    return {
        skillId: 'visual-analysis',
        skillParams: {
            sourceType,
            analysisFocus: 'general',
            userIntent: context.userInput
        },
        thinking: sourceType === 'attached_image'
            ? '读取用户本轮上传的图片并做只读视觉分析。'
            : '读取当前画面快照并做只读视觉检查。'
    };
}

/**
 * 执行点约束：意图控制面只授权只读（read_only）时，确定性路由不得直接执行写类技能。
 * 例：「看一下详情页文档有几屏」关键词会命中 detail-page-design（制作详情页的写类工作流），
 * 但用户要的是查看而不是制作——此时跳过该确定性候选，交给只读回退或自主循环。
 * 技能读写分类复用 shared/agent-tool-execution-preflight，不在引擎里另建技能名单。
 */
function isDeterministicRouteCompatibleWithToolScope(
    route: ReturnType<typeof fastDeterministicRoute>,
    intentControlPlane: AgentIntentControlPlaneDecision
): boolean {
    if (!route) return false;
    if (
        route.skillId === 'document-management'
        && intentControlPlane.requestKind === 'autonomous_execution'
        && intentControlPlane.matchedSignals?.includes('explicit_creative_design') === true
    ) {
        return false;
    }
    if (intentControlPlane.toolScope !== 'read_only') return true;
    const kind = classifyAgentToolExecution(route.skillId, route.skillParams);
    return kind === 'read_only_observation' || kind === 'knowledge_search';
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

/**
 * 路由选择不等于执行授权。只读/知识能力可在非 none 范围内运行；其余 Skill（含未知分类）
 * 必须同时具备 confirmed_tool_required 与 write_photoshop，candidate_only 只能进入 Agent/public-plan。
 */
export function canExecuteSkillUnderIntentAuthorization(
    skillId: string,
    skillParams: Record<string, any> | undefined,
    intentControlPlane: AgentIntentControlPlaneDecision
): boolean {
    const skillBridgesForbidden = intentControlPlane.matchedSignals.includes('explicit_skill_bridge_forbidden')
        || intentControlPlane.matchedSignals.includes('semantic_skill_bridge_forbidden');
    if (skillBridgesForbidden) {
        const declaration = getSkillById(skillId);
        if (!declaration || declaration.visibility === 'user-facing') return false;
    }
    const executionKind = classifyAgentToolExecution(skillId, skillParams);
    if (executionKind === 'read_only_observation' || executionKind === 'knowledge_search') {
        return intentControlPlane.toolScope !== 'none'
            && intentControlPlane.executionAuthorization !== 'none';
    }
    return intentControlPlane.toolScope === 'write_photoshop'
        && intentControlPlane.executionAuthorization === 'confirmed_tool_required';
}

function hasConfirmedToolExecutionAuthorization(
    intentControlPlane?: AgentIntentControlPlaneDecision
): boolean {
    return intentControlPlane?.executionAuthorization === 'confirmed_tool_required';
}

function isConfirmedAutonomousTask(
    intentControlPlane?: AgentIntentControlPlaneDecision,
    skillId?: string
): boolean {
    return skillId === 'autonomous-agent'
        && intentControlPlane?.requestKind === 'autonomous_execution'
        && hasConfirmedToolExecutionAuthorization(intentControlPlane);
}

function isExplicitProjectContextAutonomousDeliveryFallback(
    context: AgentContext,
    agentTaskPlan: AgentTaskPlanningContract,
    skillId?: string
): boolean {
    const approval = context.agentTaskPublicPlanApproval;
    const text = String(context.userInput || '');
    const hasProjectMaterialIntent = /(?:当前项目|这个项目|本项目|项目).{0,32}(?:图片|素材|资源|照片)|使用当前项目/u.test(text);
    const hasDeliveryIntent = /(?:完成|交付|产出|创建|生成|制作|设计|导出|保存|可验收).{0,48}(?:主图|详情页|长图|海报|banner|视觉|设计稿)|(?:主图|详情页|长图|海报|banner|视觉|设计稿).{0,48}(?:完成|交付|产出|创建|生成|制作|设计|导出|保存|可验收)/iu.test(text);
    return skillId === 'autonomous-agent'
        && agentTaskPlan.status === 'ready_for_model_planning'
        && agentTaskPlan.requestKind === 'autonomous_execution'
        && approval?.approveGeneratedPublicPlan === true
        && approval.userConfirmed === true
        && approval.allowPhotoshopWrites === true
        && approval.liveExecutionScope === 'disposable-document'
        && Boolean(context.projectContext?.projectPath)
        && hasProjectMaterialIntent
        && hasDeliveryIntent;
}

function buildSkillUnavailableResult(skillId: string, userInput: string): AgentResult | null {
    const publicUnavailableMessage =
        getInternalAgentStatusPublicMessage('skill executor not found')
        || '这个操作暂时还不能直接完成；本轮不会改动画面。';
    if (!canExecuteSkillFromUserRequest(skillId, userInput)) {
        return {
            success: false,
            message: publicUnavailableMessage,
            error: 'Skill not user-invocable'
        };
    }
    if (!isSkillEnabled(skillId)) {
        return {
            success: false,
            message: getInternalAgentStatusPublicMessage('skill disabled') || publicUnavailableMessage,
            error: 'Skill disabled'
        };
    }
    if (!getSkillExecutor(skillId)) {
        return {
            success: false,
            message: publicUnavailableMessage,
            error: 'Skill executor not found'
        };
    }
    return null;
}

function isCompletedPublicPlanControlledRun(run: AgentTaskPublicPlanControlledRun): boolean {
    return run.status === 'completed_live_adapter_verified'
        || run.status === 'completed_fake_adapter_verified'
        || run.status === 'completed_dry_run';
}

const NON_RECOVERABLE_PUBLIC_PLAN_CONTROLLED_RUN_STATUSES = new Set([
    'blocked_request_not_ready',
    'blocked_adapter_required',
    'blocked_live_write_permission_missing',
    'blocked_live_execution_scope_required',
    'blocked_live_project_write_approval_required',
    'blocked_live_adapter_required',
    'blocked_readback_adapter_required'
]);

function shouldRecoverFromPublicPlanControlledRunFailure(run: AgentTaskPublicPlanControlledRun): boolean {
    if (isCompletedPublicPlanControlledRun(run)) return false;
    return !NON_RECOVERABLE_PUBLIC_PLAN_CONTROLLED_RUN_STATUSES.has(run.status);
}

/**
 * 确认范围内处理失败后，构造包含失败信息的恢复 task，传给 Agent ReAct + Reflexion。
 * Agent 在 ReAct 循环中观察失败、决定换路（检查 PS 连接、调整参数、换用替代方案）；
 * Agent 失败后走 Reflexion 回路（上一轮实现的 while 循环）。
 */
function buildControlledRunFailureRecoveryTask(
    approvalRecord: ReturnType<typeof buildAgentTaskPublicPlanApprovalRecord>,
    controlledRun: AgentTaskPublicPlanControlledRun,
    scopeContext?: {
        liveExecutionScope?: unknown;
        explicitProjectWriteApproval?: unknown;
    }
): string {
    const originalGoal = approvalRecord.agentTaskPlan?.designBrief?.goal
        || approvalRecord.agentTaskPublicPlan?.message
        || '';
    const planSummary = controlledRun.executionPlanSummary
        || controlledRun.publicPlanSummary
        || approvalRecord.agentTaskPublicPlan?.executionPlanSummary
        || '';
    const succeededOps = controlledRun.operationResults
        .filter((r) => r.success)
        .map((r) => r.toolName);
    const failedOps = controlledRun.operationResults
        .filter((r) => !r.success)
        .map((r) => `${r.toolName}（${r.error || '未知错误'}）`);

    // 保留原确认范围的执行边界约束，防止 Agent 在恢复时超出用户已批准的范围
    const scopeConstraints: string[] = [];
    const allowedWriteTools = approvalRecord.allowedWriteTools;
    if (Array.isArray(allowedWriteTools) && allowedWriteTools.length > 0) {
        scopeConstraints.push(`本次恢复仅允许使用以下写入工具：${allowedWriteTools.join('、')}。不要使用超出此范围的写入操作。`);
    }
    const liveExecutionScope = scopeContext?.liveExecutionScope;
    if (liveExecutionScope && typeof liveExecutionScope === 'object') {
        const scopeParts = Object.entries(liveExecutionScope)
            .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join('/') : String(value)}`)
            .filter(Boolean);
        if (scopeParts.length > 0) {
            scopeConstraints.push(`执行范围约束：${scopeParts.join('；')}。`);
        }
    }

    return [
        originalGoal || '执行已确认的设计方案',
        '',
        '【确认范围内处理失败，转入 Agent 自主恢复】',
        planSummary ? `已确认的计划：${planSummary}` : '',
        succeededOps.length ? `已成功完成的操作：${succeededOps.join('、')}（不要重复执行）` : '',
        failedOps.length ? `失败的操作：\n${failedOps.map((op) => `- ${op}`).join('\n')}` : '',
        controlledRun.blockers.length ? `失败原因：${controlledRun.blockers.join('；')}` : '',
        scopeConstraints.length ? `\n执行边界约束（必须遵守）：\n${scopeConstraints.map((s) => `- ${s}`).join('\n')}` : '',
        '',
        '请在失败的操作上换路重试：检查 Photoshop 连接状态、调整工具参数或换用替代方案。',
        '不要重新规划整个任务，已成功的操作不要重复执行。'
    ].filter(Boolean).join('\n');
}

function formatReadableList(items: string[], fallback = '画面内容'): string {
    const cleaned = items.map((item) => String(item || '').trim()).filter(Boolean);
    if (cleaned.length === 0) return fallback;
    if (cleaned.length === 1) return cleaned[0];
    return `${cleaned.slice(0, -1).join('、')}和${cleaned[cleaned.length - 1]}`;
}

function summarizeReadbackTargetsForUser(targets: string[]): string[] {
    const output: string[] = [];
    const joined = targets.join(' ');
    if (/layer_hierarchy|layer_properties|document_info/i.test(joined)) {
        output.push('可编辑图层');
    }
    if (/acceptance_snapshot|document_snapshot|annotated_snapshot/i.test(joined)) {
        output.push('画面内容');
    }
    if (output.length === 0 && targets.length > 0) {
        output.push('画面内容');
    }
    return Array.from(new Set(output));
}

function summarizeBlocksForUser(blocks: any[]): string {
    const title = blocks.find((block) => block?.role === 'title' && block.content)?.content;
    const sellingPoints = blocks
        .filter((block) => block?.role === 'selling-point' && block.content)
        .map((block) => String(block.content).trim())
        .filter(Boolean);
    const parts = ['版面'];
    if (blocks.some((block) => block?.role === 'background')) parts.push('背景');
    if (title) parts.push(`标题“${sanitizeAgentTaskPublicPlanDisplayText(title, 60)}”`);
    if (sellingPoints.length > 0) parts.push(`${sellingPoints.length} 个卖点色块`);
    return parts.join('、');
}

function summarizeOperationForUser(operation: AgentTaskPublicPlanControlledOperationRequest): string {
    const params = operation.params && typeof operation.params === 'object'
        ? operation.params as Record<string, any>
        : {};
    if (operation.toolName === 'createDocument') {
        const width = Number(params.width);
        const height = Number(params.height);
        const size = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
            ? `${Math.round(width)}x${Math.round(height)}`
            : '';
        return size ? `${size} 临时画布` : '临时画布';
    }
    if (operation.toolName === 'renderLayout') {
        const blocks = Array.isArray(params.blocks) ? params.blocks : [];
        return blocks.length > 0 ? summarizeBlocksForUser(blocks) : '版面内容';
    }
    if (operation.toolName === 'placeImage') {
        return '项目图片';
    }
    if (operation.toolName === 'saveDocument') {
        return '导出文件';
    }
    if (operation.toolName === 'createTextLayer' || operation.toolName === 'setTextContent') {
        const content = sanitizeAgentTaskPublicPlanDisplayText(params.content || params.text, 60);
        return content ? `可编辑文字“${content}”` : '可编辑文字';
    }
    if (operation.toolName === 'createRectangle' || operation.toolName === 'createEllipse') {
        return '简单色块';
    }
    return sanitizeAgentTaskPublicPlanDisplayText(operation.paramsSummary, 80) || '一项画面调整';
}

function summarizeDesignDecisionFromOperations(run: AgentTaskPublicPlanControlledRun): string {
    const renderOperation = run.operationRequests.find((operation) => operation.toolName === 'renderLayout');
    const params = renderOperation?.params && typeof renderOperation.params === 'object'
        ? renderOperation.params as Record<string, any>
        : {};
    const blocks = Array.isArray(params.blocks) ? params.blocks : [];
    const title = blocks.find((block) => block?.role === 'title' && block.content)?.content;
    const sellingPoints = blocks
        .filter((block) => block?.role === 'selling-point' && block.content)
        .map((block) => String(block.content).trim())
        .filter(Boolean);
    if (title && sellingPoints.length > 0) {
        return `用标题“${sanitizePublicPlanUserFacingText(title, 60)}”先明确主题，再用 ${sellingPoints.length} 个卖点模块承接购买理由。`;
    }
    if (title) {
        return `先用标题“${sanitizePublicPlanUserFacingText(title, 60)}”建立首屏主题，再保留后续版面调整空间。`;
    }
    if (sellingPoints.length > 0) {
        return `先用 ${sellingPoints.length} 个卖点模块搭出基础购买理由，再继续补充图片和细节。`;
    }
    return '';
}

function summarizeControlledRunDesignDecisionForUser(run: AgentTaskPublicPlanControlledRun): string {
    const rawDecision = sanitizePublicPlanUserFacingText(run.publicPlanSummary, 220)
        .replace(/^公开设计计划[：:]\s*/u, '')
        .replace(/；?等待用户确认后才允许(?:受控)?执行。?$/u, '')
        .replace(/；?确认后(?:才)?(?:允许|开始)(?:受控)?执行。?$/u, '')
        .trim();
    if (!rawDecision) return summarizeDesignDecisionFromOperations(run);
    if (rawDecision.length > 120 || /计划分[一二三四五六七八九十\d]?步/u.test(rawDecision)) {
        return summarizeDesignDecisionFromOperations(run) || rawDecision;
    }
    return rawDecision;
}

function summarizeControlledRunExecutionIdeaForUser(run: AgentTaskPublicPlanControlledRun): string {
    const explicitSummary = sanitizePublicPlanUserFacingText(run.executionPlanSummary, 220);
    if (explicitSummary) return explicitSummary;
    const operationSummaries = run.operationRequests
        .map((operation) => sanitizePublicPlanUserFacingText(operation.paramsSummary, 120))
        .filter(Boolean);
    return operationSummaries[0] || '';
}

function summarizeObservationDiffForUser(run: AgentTaskPublicPlanControlledRun): string {
    const diff = run.observationDiff;
    if (!diff || diff.status !== 'mismatch') return '';
    const summary = sanitizePublicPlanUserFacingText(diff.userVisibleSummary, 180);
    const missingCopy = diff.missingVisibleCopy
        .map((item) => sanitizePublicPlanUserFacingText(item, 40))
        .filter(Boolean)
        .slice(0, 4);
    if (summary) return summary;
    if (missingCopy.length > 0) {
        return `画面里暂时没有看到「${missingCopy.join('」「')}」。`;
    }
    return '真实画面和原计划不一致，需要继续观察或调整。';
}

function emitControlledRunVisibleReview(
    callbacks: ProcessOptions['callbacks'],
    run: AgentTaskPublicPlanControlledRun
): void {
    const observationDiff = summarizeObservationDiffForUser(run);
    const completed = isCompletedPublicPlanControlledRun(run);
    const blocker = sanitizePublicPlanUserFacingText(run.blockers.find(Boolean), 180);
    const detail = observationDiff
        ? `${observationDiff} 下一步应先修正这处差异，或确认这是用户主动删改后的新目标。`
        : completed
            ? '我已经看过真实画面，计划中的主要内容仍然存在，可以继续进入下一步人工审美确认。'
            : blocker || '真实画面还没有达到计划状态，需要继续补齐条件后再处理。';

    callbacks?.onStep?.({
        kind: 'verification',
        title: observationDiff ? '复核真实画面' : '复核画面结果',
        detail,
        status: completed ? 'success' : 'error',
        percent: completed ? 100 : 82
    });
}

function formatPublicPlanControlledRunMessage(run: AgentTaskPublicPlanControlledRun): string {
    const completedOperations = run.operationRequests
        .filter((operation) => (
            run.operationResults.length === 0
            || run.operationResults.some((result) => result.operationId === operation.operationId && result.success)
        ))
        .map(summarizeOperationForUser);
    const reviewTargets = summarizeReadbackTargetsForUser(run.readbackTargets);
    const designDecision = summarizeControlledRunDesignDecisionForUser(run);
    const executionIdea = summarizeControlledRunExecutionIdeaForUser(run);
    const observationDiff = summarizeObservationDiffForUser(run);
    if (run.status === 'completed_live_adapter_verified') {
        return [
            designDecision ? `我的设计方案判断：${designDecision}` : '已按确认的设计方案创建好临时画面。',
            executionIdea ? `这次先做：${executionIdea}` : '',
            `已完成：${formatReadableList(completedOperations, '临时画面')}。`,
            `已复核：${formatReadableList(reviewTargets, '画面内容')}。`,
            '建议再看一下整体留白、对齐和文字大小，确认视觉效果是否符合预期。'
        ].filter(Boolean).join('\n');
    }
    if (run.status === 'completed_fake_adapter_verified' || run.status === 'completed_dry_run') {
        return [
            designDecision ? `我的设计方案判断：${designDecision}` : '这份设计方案已经检查过，本轮没有改动画面。',
            executionIdea ? `这次会先做：${executionIdea}` : '',
            '需要落地时，我会先创建临时画布，再生成可编辑的文字和色块。'
        ].filter(Boolean).join('\n');
    }

    if (run.status === 'failed_readback' && observationDiff) {
        return [
            designDecision ? `我的设计方案判断：${designDecision}` : '我已经按方案做了当前阶段画面。',
            executionIdea ? `原计划：${executionIdea}` : '',
            `我复核后看到：${observationDiff}`,
            '这还不是最终完成状态。下一步应该把这次观察差异交回 Agent，继续补齐画面并再次复核。'
        ].filter(Boolean).join('\n');
    }

    return [
        designDecision ? `我的设计方案判断：${designDecision}` : '已确认设计方案，但这次没有改动画面。',
        executionIdea ? `原计划：${executionIdea}` : '',
        '画面创建过程中有一步没有完成，需要补齐可直接创建画面的条件后再继续。'
    ].filter(Boolean).join('\n');
}

function shouldRepairAfterControlledRunObservation(run: AgentTaskPublicPlanControlledRun): boolean {
    return run.status === 'failed_readback'
        && run.observationDiff?.status === 'mismatch'
        && ['repair_missing_visible_copy', 'observe_again'].includes(run.observationDiff.nextAction);
}

function buildControlledRunRepairTaskText(input: {
    context: AgentContext;
    run: AgentTaskPublicPlanControlledRun;
}): string {
    const diff = input.run.observationDiff;
    const missingCopy = (diff?.missingVisibleCopy || [])
        .map((item) => sanitizePublicPlanUserFacingText(item, 50))
        .filter(Boolean)
        .slice(0, 8);
    const observedCopy = (diff?.observedVisibleCopy || [])
        .map((item) => sanitizePublicPlanUserFacingText(item, 50))
        .filter(Boolean)
        .slice(0, 8);
    const summary = sanitizePublicPlanUserFacingText(diff?.userVisibleSummary, 220);

    // 保留原确认范围的执行边界约束，与 buildControlledRunFailureRecoveryTask 保持一致
    const scopeConstraints: string[] = [];
    const approval = input.context.agentTaskPublicPlanApproval;
    if (approval?.allowedWriteTools && Array.isArray(approval.allowedWriteTools) && approval.allowedWriteTools.length > 0) {
        scopeConstraints.push(`本次修复仅允许使用以下写入工具：${approval.allowedWriteTools.join('、')}。不要使用超出此范围的写入操作。`);
    }

    return [
        '继续当前设计任务。真实画面复核发现上一轮结果还没有完成，请不要询问用户确认，先自己继续修复。',
        input.context.userInput ? `原始任务：${input.context.userInput}` : '',
        summary ? `真实画面复核发现：${summary}` : '',
        missingCopy.length > 0 ? `需要补齐的画面内容：${missingCopy.join('、')}` : '',
        observedCopy.length > 0 ? `已经观察到的画面内容：${observedCopy.join('、')}` : '',
        scopeConstraints.length ? `\n执行边界约束（必须遵守）：\n${scopeConstraints.map((s) => `- ${s}`).join('\n')}` : '',
        '下一步：先观察或读取当前 Photoshop 画面，判断缺失内容应该补回、重排还是重新生成当前阶段；修复后必须再次观察真实画面，再决定是否继续。'
    ].filter(Boolean).join('\n');
}

function buildPublicPlanControlledRunResult(input: {
    approvalRecord: unknown;
    executionRequest: unknown;
    controlledRun: AgentTaskPublicPlanControlledRun;
}): AgentResult {
    const completed = isCompletedPublicPlanControlledRun(input.controlledRun);
    const agentReActObservation = buildAgentReActObservationFromPublicPlanRun(input.controlledRun);
    const result: AgentResult = {
        success: completed,
        message: formatPublicPlanControlledRunMessage(input.controlledRun),
        error: completed ? undefined : input.controlledRun.status,
        data: {
            agentTaskPublicPlanApprovalRecord: input.approvalRecord,
            agentTaskPublicPlanExecutionRequest: input.executionRequest,
            agentTaskPublicPlanControlledRun: input.controlledRun,
            agentReActObservation
        }
    };
    return withAssistantReplyOrigin(
        result,
        completed
            ? toolSummaryReplyOrigin('public-plan-controlled-run')
            : deterministicBlockerReplyOrigin(`public-plan-controlled-run:${input.controlledRun.status}`)
    );
}

function isExplicitDelegatedGoalOwnedByAgent(
    intentControlPlane: AgentIntentControlPlaneDecision
): boolean {
    return intentControlPlane.requestKind === 'autonomous_execution'
        && intentControlPlane.executionAuthorization !== 'none'
        && intentControlPlane.toolScope !== 'none'
        && intentControlPlane.matchedSignals?.includes('explicit_task_delegation') === true;
}

// 受控工作流是否应进入 ReAct 循环由 SkillDeclaration.controlledRouteEntry 单一声明派生。
// routeClass 只描述能力类别，不能替代运行入口契约。
function shouldEnterAutonomousReActForControlledRoute(
    skillId: string | undefined,
    intentControlPlane: AgentIntentControlPlaneDecision
): boolean {
    return intentControlPlane.executionAuthorization !== 'none'
        && intentControlPlane.toolScope !== 'none'
        && Boolean(skillId)
        && (
            isExplicitDelegatedGoalOwnedByAgent(intentControlPlane)
            || isControlledRouteAutonomousEntrySkill(normalizeSkillId(skillId) || String(skillId))
        );
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
        observations?: Array<{ source: string; summary: string }>;
    }
): AgentRequestLifecycleRecord {
    return buildAgentRequestLifecycle({
        userInput: context.userInput,
        context,
        ...input
    });
}

function attachLifecycle(
    result: AgentResult,
    lifecycle: AgentRequestLifecycleRecord,
    intentControlPlane?: AgentIntentControlPlaneDecision,
    entryAgentTaskPlan?: AgentTaskPlanningContract
): AgentResult {
    const resultWithLifecycle = withAgentRequestLifecycle(result, lifecycle);
    const currentData = resultWithLifecycle.data && typeof resultWithLifecycle.data === 'object'
        ? resultWithLifecycle.data as Record<string, unknown>
        : {};
    const planning = entryAgentTaskPlan
        ? {
            intentControlPlane: intentControlPlane || buildAgentIntentControlPlaneDecision({
                userInput: lifecycle.request.rawText,
                hasImageInput: lifecycle.context.hasImageInput,
                hasDocument: lifecycle.context.hasDocument,
                photoshopConnected: lifecycle.context.photoshopConnected
            }),
            agentTaskPlan: entryAgentTaskPlan
        }
        : buildAgentTaskPlanForLifecycle(lifecycle, intentControlPlane);
    const agentTaskPlan = applyRuntimeFailureUserVisibleState(
        planning.agentTaskPlan,
        resultWithLifecycle,
        lifecycle
    );

    return {
        ...resultWithLifecycle,
        data: {
            ...currentData,
            agentIntentControlPlane: planning.intentControlPlane,
            agentTaskPlan
            // GATE-SIMPLIFY-009：agentIntentDeliberationGate 已退役——diagnosticOnly 四字段
            // 不拦路由/执行，无事故证据；决策来源主口径继续由 decision.source 承担。
        }
    };
}

function withAssistantReplyOrigin(
    result: AgentResult,
    assistantReplyOrigin: AssistantReplyOrigin
): AgentResult {
    const currentData = result.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : {};
    const resultWithOrigin: AgentResult = {
        ...result,
        assistantReplyOrigin,
        data: {
            ...currentData,
            assistantReplyOrigin
        }
    };
    const notice = buildAgentUserVisibleNoticeFromOrigin(resultWithOrigin, assistantReplyOrigin);
    return notice ? withAgentUserVisibleNotice(resultWithOrigin, notice) : resultWithOrigin;
}

function stripAgentUserVisibleNotice(result: AgentResult): AgentResult {
    const currentData = result.data && typeof result.data === 'object'
        ? { ...(result.data as Record<string, unknown>) }
        : undefined;
    if (currentData) {
        delete currentData.userVisibleNotice;
    }
    const next: AgentResult = {
        ...result,
        ...(currentData ? { data: currentData } : {})
    };
    delete (next as any).userVisibleNotice;
    return next;
}

function readSkillExecutionSummary(result: AgentResult): Record<string, unknown> | undefined {
    const direct = (result as any)?.executionSummary;
    if (direct && typeof direct === 'object') return direct as Record<string, unknown>;
    const data = result.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : undefined;
    const nested = data?.executionSummary;
    if (nested && typeof nested === 'object') return nested as Record<string, unknown>;
    return undefined;
}

function shouldTreatSkillResultAsToolSummary(result: AgentResult): boolean {
    if (result.success !== false) return true;
    const summary = readSkillExecutionSummary(result);
    const status = String(summary?.status || '').trim();
    const successfulToolCalls = Number(summary?.successfulToolCalls || 0);
    const toolCallCount = Number(summary?.toolCallCount || 0);
    return status === 'needs_review' && successfulToolCalls > 0 && toolCallCount > 0;
}

function resolveSkillResultReplyOrigin(result: AgentResult, skillId: string): AssistantReplyOrigin {
    return shouldTreatSkillResultAsToolSummary(result)
        ? toolSummaryReplyOrigin(`skill:${skillId}${result.success === false ? ':needs-review' : ''}`)
        : deterministicBlockerReplyOrigin(`skill:${skillId}:failure`);
}

type ModelMediatedSkillReplyUnavailableReason =
    | 'missing_call_model'
    | 'unsupported_call_model'
    | 'model_call_threw'
    | 'empty_model_text'
    | 'sanitized_empty';

function previewModelMediationDebugText(value: unknown, maxLength = 4000): string | undefined {
    const text = String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/ig, '[binary-redacted]')
        .replace(/\b[A-Za-z]:[\\/][^\s;；,，]+/g, '[local-path-redacted]')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return undefined;
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function describeModelResponseShape(response: unknown): string {
    if (response === null) return 'null';
    if (response === undefined) return 'undefined';
    if (typeof response !== 'object') return typeof response;
    const keys = Object.keys(response as Record<string, unknown>).slice(0, 12);
    return keys.length > 0 ? `object:${keys.join(',')}` : 'object:no-keys';
}

function buildModelMediatedSkillReplyUnavailableResult(
    result: AgentResult,
    skillId: string,
    reason: ModelMediatedSkillReplyUnavailableReason,
    debug?: {
        rawResponse?: unknown;
        rawText?: string;
        sanitizedText?: string;
        error?: unknown;
    }
): AgentResult {
    const stripped = stripAgentUserVisibleNotice(result);
    const currentData = stripped.data && typeof stripped.data === 'object'
        ? stripped.data as Record<string, unknown>
        : {};
    return withAssistantReplyOrigin(
        {
            ...stripped,
            message: '这一步已经拿到工具结果，但当前模型没有生成面向用户的判断。我不会把工具日志直接当成设计结论；请稍后重试或切换可用模型后继续。',
            data: {
                ...currentData,
                modelMediatedUserReplyUnavailable: {
                    version: 'model-mediated-user-reply-unavailable/v0',
                    skillId,
                    reason,
                    rawResponseShape: debug && 'rawResponse' in debug
                        ? describeModelResponseShape(debug.rawResponse)
                        : undefined,
                    rawTextPreview: previewModelMediationDebugText(debug?.rawText),
                    sanitizedTextPreview: previewModelMediationDebugText(debug?.sanitizedText),
                    errorPreview: previewModelMediationDebugText(debug?.error instanceof Error ? debug.error.message : debug?.error)
                }
            }
        },
        uiStatusReplyOrigin(`skill:${skillId}:model-mediated-reply-unavailable`)
    );
}

async function mediateSkillResultUserReplyWithModel(input: {
    result: AgentResult;
    skillId: string;
    context: AgentContext;
    callModel?: ProcessOptions['callModel'];
}): Promise<AgentResult> {
    if (!requiresModelMediatedUserReply({
        skillId: input.skillId,
        success: input.result.success,
        userVisibleKind: 'tool_summary'
    })) {
        return withAssistantReplyOrigin(
            input.result,
            resolveSkillResultReplyOrigin(input.result, input.skillId)
        );
    }

    if (!input.callModel) {
        return buildModelMediatedSkillReplyUnavailableResult(input.result, input.skillId, 'missing_call_model');
    }

    if ((input.callModel as any).supportsModelMediatedUserReply !== true) {
        return buildModelMediatedSkillReplyUnavailableResult(input.result, input.skillId, 'unsupported_call_model');
    }

    try {
        const modelResponse = await input.callModel(
            buildModelMediatedSkillReplyMessages({
                userInput: input.context.userInput,
                skillId: input.skillId,
                skillResultMessage: input.result.message,
                resultData: input.result.data
            }),
            {
                temperature: 0.2,
                maxTokens: 700,
                stream: false,
                purpose: 'skill_result_user_reply',
                includeAttachedImages: false,
                thinkingEnabled: false
            }
        );
        const rawModelText = extractModelVisibleText(modelResponse);
        if (!rawModelText) {
            return buildModelMediatedSkillReplyUnavailableResult(
                input.result,
                input.skillId,
                'empty_model_text',
                { rawResponse: modelResponse }
            );
        }
        // 这段文本由已执行技能的结果（skillResultMessage + resultData）驱动生成，属工具结果支撑的汇报，
        // 不是「该干活却只做能力推销」的空谈——不能套用罐头能力菜单判据，否则正当的计划汇报会被整段清空。
        const modelText = sanitizeUserVisibleAssistantBodyText(rawModelText, { toolResultBacked: true });
        if (!modelText) {
            return buildModelMediatedSkillReplyUnavailableResult(
                input.result,
                input.skillId,
                'sanitized_empty',
                {
                    rawResponse: modelResponse,
                    rawText: rawModelText,
                    sanitizedText: modelText
                }
            );
        }
        return withAssistantReplyOrigin(
            {
                ...stripAgentUserVisibleNotice(input.result),
                message: modelText,
                data: {
                    ...(input.result.data && typeof input.result.data === 'object' ? input.result.data : {}),
                    modelMediatedUserReply: {
                        version: 'model-mediated-user-reply/v0',
                        skillId: input.skillId,
                        modelPurpose: 'skill_result_user_reply'
                    }
                }
            },
            modelAuthoredReplyOrigin(`skill:${input.skillId}:model-mediated-user-reply`, 'skill_result_user_reply')
        );
    } catch (error) {
        console.warn(`[DesignAgentEngine] 模型组织 skill 用户回复失败：${input.skillId}`, error);
        return buildModelMediatedSkillReplyUnavailableResult(
            input.result,
            input.skillId,
            'model_call_threw',
            { error }
        );
    }
}

function withAgentUserVisibleNotice(
    result: AgentResult,
    notice: AgentUserVisibleNotice
): AgentResult {
    const currentData = result.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : {};
    return {
        ...result,
        userVisibleNotice: notice,
        data: {
            ...currentData,
            userVisibleNotice: notice
        }
    };
}

function buildAgentUserVisibleNoticeFromOrigin(
    result: AgentResult,
    assistantReplyOrigin: AssistantReplyOrigin
): AgentUserVisibleNotice | undefined {
    const content = String(result.message || '').trim();
    if (!content) return undefined;

    if (assistantReplyOrigin.userVisibleKind === 'status_notice') {
        return {
            kind: 'status_notice',
            content,
            source: assistantReplyOrigin.source
        };
    }
    if (assistantReplyOrigin.userVisibleKind === 'tool_summary') {
        return {
            kind: 'tool_summary',
            content,
            source: assistantReplyOrigin.source
        };
    }
    if (assistantReplyOrigin.userVisibleKind === 'blocker_notice') {
        return {
            kind: 'blocker_notice',
            content,
            source: assistantReplyOrigin.source
        };
    }
    return undefined;
}
function collectRuntimeFailureText(result: AgentResult): string {
    const parts: unknown[] = [
        result.error,
        result.message
    ];
    for (const toolResult of Array.isArray(result.toolResults) ? result.toolResults : []) {
        if (!toolResult || typeof toolResult !== 'object') continue;
        const record = toolResult as Record<string, unknown>;
        parts.push(record.error, record.message, record.status, record.summary);
    }
    return parts
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .join('\n')
        .slice(0, 6000);
}

function readStructuredRuntimeFailureStatus(value: unknown, depth = 0): string {
    if (depth > 4 || value === null || value === undefined) return '';
    if (typeof value === 'string') {
        const status = value.trim();
        return /^blocked_[a-z0-9_:-]{1,96}$/i.test(status) ? status : '';
    }
    if (Array.isArray(value)) {
        for (const item of value.slice(0, 64)) {
            const status = readStructuredRuntimeFailureStatus(item, depth + 1);
            if (status) return status;
        }
        return '';
    }
    if (typeof value !== 'object') return '';

    const record = value as Record<string, unknown>;
    for (const key of ['status', 'code', 'errorCode', 'runtimeStatus']) {
        const status = readStructuredRuntimeFailureStatus(record[key], depth + 1);
        if (status) return status;
    }
    for (const key of ['data', 'result', 'failure', 'toolResults']) {
        const status = readStructuredRuntimeFailureStatus(record[key], depth + 1);
        if (status) return status;
    }
    return '';
}

function resolveRuntimeFailureStatus(result: AgentResult): string {
    if (result.success !== false) return '';

    const structuredStatus = readStructuredRuntimeFailureStatus({
        data: result.data,
        toolResults: result.toolResults
    });
    if (structuredStatus) return structuredStatus;

    const text = collectRuntimeFailureText(result);
    if (/(?:photoshop_not_connected|Photoshop\s*未连接|未连接\s*Photoshop|plugin.*not connected|not connected to Photoshop)/i.test(text)) {
        return 'blocked_missing_photoshop_connection';
    }
    if (/(?:photoshop_document_required|没有打开文档|当前没有打开文档|no document|document required|target document not found)/i.test(text)) {
        return 'blocked_missing_document';
    }
    return '';
}

function applyRuntimeFailureUserVisibleState(
    agentTaskPlan: AgentTaskPlanningContract,
    result: AgentResult,
    lifecycle: AgentRequestLifecycleRecord
): AgentTaskPlanningContract {
    const runtimeStatus = resolveRuntimeFailureStatus(result);
    if (!runtimeStatus) return agentTaskPlan;

    return {
        ...agentTaskPlan,
        userVisibleState: buildAgentUserVisibleState({
            route: lifecycle.decision.route,
            planningStatus: runtimeStatus,
            requestKind: agentTaskPlan.requestKind
        }),
        blockers: Array.from(new Set([
            ...agentTaskPlan.blockers,
            runtimeStatus
        ])),
        planningContext: [
            ...agentTaskPlan.planningContext,
            {
                source: 'agent-runtime-failure',
                summary: `runtimeStatus=${runtimeStatus}`
            }
        ]
    };
}

function buildAgentTaskPlanForLifecycle(
    lifecycle: AgentRequestLifecycleRecord,
    intentControlPlane?: AgentIntentControlPlaneDecision,
    forcePublicPlanGeneration = false,
    requiresTaskProgress = false,
    taskProgressObligation?: AgentTaskProgressObligation
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
            lifecycle,
            skillId: lifecycle.decision.selectedSkillId || lifecycle.decision.skillId,
            taskType: lifecycle.decision.taskType,
            workMode: lifecycle.decision.workMode,
            mode: lifecycle.decision.mode,
            skillParams: lifecycle.decision.skillParams,
            forcePublicPlanGeneration,
            requiresTaskProgress,
            taskProgressObligation
        })
    };
}

function buildAgentTaskPlanBlockedMessage(agentTaskPlan: AgentTaskPlanningContract): string {
    if (agentTaskPlan.status === 'ready_for_model_planning') {
        return buildConversationalUnavailableMessage({ audience: 'general', kind: 'unknown' });
    }
    if (agentTaskPlan.status === 'blocked_needs_clarification') {
        return buildConversationalUnavailableMessage({ audience: 'general', kind: 'unknown' });
    }
    return buildConversationalUnavailableMessage({ audience: 'general', kind: 'unknown' });
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
    requiredInputs: string[];
    verificationTargets: string[];
    generatedAt: string;
}

type AgentTaskPublicPlanPayload = Omit<
    AgentTaskPublicPlan,
    'status' | 'source' | 'canExecuteTools' | 'requiredInputs' | 'verificationTargets' | 'generatedAt'
> & {
    runtimeOperationRequests: AgentTaskPublicPlanControlledOperationRequest[];
};

interface AgentTaskPublicPlanDraft {
    publicPlan: AgentTaskPublicPlan;
    runtimeOperationRequests: AgentTaskPublicPlanControlledOperationRequest[];
}

class AgentTaskPublicPlanModelUnavailableError extends Error {
    constructor() {
        super('agent_task_public_plan_model_unavailable');
        this.name = 'AgentTaskPublicPlanModelUnavailableError';
    }
}

function isAgentTaskPublicPlanAbortError(error: unknown, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true;
    if (!error || typeof error !== 'object') return false;
    const value = error as { name?: unknown; code?: unknown };
    return value.name === 'AbortError' || value.code === 'ABORT_ERR';
}

function buildGeneratedPublicPlanApprovalRecord(input: {
    context: AgentContext;
    planning: ReturnType<typeof buildAgentTaskPlanForLifecycle>;
    publicPlan: AgentTaskPublicPlan;
    executionRequest: AgentTaskPublicPlanExecutionRequest;
}): Record<string, unknown> {
    const request = input.executionRequest;
    return {
        version: 'agent-task-public-plan-approval-record/v0',
        requested: true,
        status: 'approved_controlled_execution_request',
        userConfirmed: true,
        requestId: request.requestId,
        sourceMessageId: input.context.agentTaskPublicPlanApproval?.sourceMessageId,
        allowedWriteTools: request.allowedWriteTools || input.context.agentTaskPublicPlanApproval?.allowedWriteTools || [],
        approvedWriteTools: request.approvedWriteTools || [],
        blockedWriteTools: request.blockedWriteTools || [],
        enableControlledExecutionRequest: true,
        blockers: [],
        warnings: ['用户首轮已经明确要求完成交付；系统按一次性文档范围执行公开方案。'],
        agentTaskPlan: input.planning.agentTaskPlan,
        agentTaskPublicPlan: input.publicPlan
    };
}

async function runGeneratedPublicPlanIfApproved(input: {
    context: AgentContext;
    planning: ReturnType<typeof buildAgentTaskPlanForLifecycle>;
    lifecycle: AgentRequestLifecycleRecord;
    publicPlan: AgentTaskPublicPlan;
    executionRequest: ReturnType<typeof buildAgentTaskPublicPlanExecutionRequest>;
    repairSkillId: string;
    repairParams?: Record<string, unknown>;
    signal?: AbortSignal;
    callbacks: ProcessOptions['callbacks'];
    callModel?: ProcessOptions['callModel'];
}): Promise<AgentResult | null> {
    const approval = input.context.agentTaskPublicPlanApproval;
    if (approval?.approveGeneratedPublicPlan !== true || approval.userConfirmed !== true) return null;

    input.callbacks?.onStep?.({
        kind: 'observation',
        title: '准备按方案处理',
        detail: input.publicPlan.executionPlanSummary
            || input.publicPlan.message
            || '先按已确认的阶段目标处理画面，完成后再看真实结果。',
        status: 'success',
        percent: 32
    });

    const controlledRun = await runAgentTaskPublicPlanControlledRunnerAsync({
        request: input.executionRequest,
        executionTarget: approval.executionTarget,
        allowPhotoshopWrites: approval.allowPhotoshopWrites,
        liveExecutionScope: approval.liveExecutionScope,
        explicitProjectWriteApproval: approval.explicitProjectWriteApproval,
        adapter: approval.adapter
    });

    emitControlledRunVisibleReview(input.callbacks, controlledRun);

    if (shouldRepairAfterControlledRunObservation(controlledRun)) {
        const agentReActObservation = buildAgentReActObservationFromPublicPlanRun(controlledRun);
        const repairTask = buildControlledRunRepairTaskText({
            context: input.context,
            run: controlledRun
        });
        input.callbacks?.onStep?.({
            kind: 'observation',
            title: '继续修复画面',
            detail: agentReActObservation.summary || '真实画面和计划不一致，回到 Agent 继续修复。',
            status: 'running',
            percent: 86
        });
        const repairResult = await executeSkillWithExecutor(input.repairSkillId, {
            params: {
                ...(input.repairParams || {}),
                userTask: repairTask,
                task: repairTask,
                originalUserTask: input.context.userInput,
                skillId: input.repairSkillId,
                agentIntentControlPlane: input.planning.intentControlPlane,
                agentReActObservation,
                runtimeAllowedWriteTools: input.context.agentTaskPublicPlanApproval?.allowedWriteTools || [],
                maxIterations: 8
            },
            callbacks: input.callbacks,
            signal: input.signal,
            context: input.context,
            agentTaskPlan: input.planning.agentTaskPlan
        });
        const repairResultWithOrigin = await mediateSkillResultUserReplyWithModel({
            result: repairResult,
            skillId: input.repairSkillId,
            context: input.context,
            callModel: input.callModel
        });
        const repairResultWithObservation = attachAgentReActObservation(
            repairResultWithOrigin,
            buildAgentReActObservationFromSkillResult({
                skillId: input.repairSkillId,
                result: repairResultWithOrigin
            })
        );
        return attachLifecycle(
            repairResultWithObservation,
            {
                ...input.lifecycle,
                decision: {
                    ...input.lifecycle.decision,
                    route: 'skill_execution',
                    skillId: input.repairSkillId,
                    reason: '复核时发现真实画面和计划不一致，已把观察差异交回 Agent 继续修复。'
                },
                execution: {
                    ...input.lifecycle.execution,
                    kind: 'deterministic_skill',
                    expectedExecutor: input.repairSkillId,
                    requiresPhotoshop: true,
                    canStart: true
                },
                warnings: [
                    ...(input.lifecycle.warnings || []),
                    ...controlledRun.warnings
                ],
                blockers: [
                    ...(input.lifecycle.blockers || []),
                    ...(repairResult.success === false ? controlledRun.blockers : [])
                ]
            },
            input.planning.intentControlPlane,
            input.planning.agentTaskPlan
        );
    }

    return attachLifecycle(
        buildPublicPlanControlledRunResult({
            approvalRecord: buildGeneratedPublicPlanApprovalRecord({
                context: input.context,
                planning: input.planning,
                publicPlan: input.publicPlan,
                executionRequest: input.executionRequest
            }),
            executionRequest: input.executionRequest,
            controlledRun
        }),
        {
            ...input.lifecycle,
            decision: {
                ...input.lifecycle.decision,
                route: 'skill_execution',
                skillId: 'autonomous-agent',
                reason: isCompletedPublicPlanControlledRun(controlledRun)
                    ? '首轮明确交付请求已授权一次性文档范围，生成公开方案后交给受控 runner 执行并复核。'
                    : '首轮明确交付请求已生成公开方案，但受控 runner 条件不足。'
            },
            execution: {
                ...input.lifecycle.execution,
                kind: 'deterministic_skill',
                expectedExecutor: 'autonomous-agent',
                requiresPhotoshop: true,
                canStart: true
            },
            warnings: [
                ...(input.lifecycle.warnings || []),
                ...controlledRun.warnings
            ],
            blockers: [
                ...(input.lifecycle.blockers || []),
                ...controlledRun.blockers
            ]
        },
        input.planning.intentControlPlane,
        input.planning.agentTaskPlan
    );
}

function sanitizeAgentTaskPublicPlanDisplayText(value: unknown, maxLength = 1200): string {
    const text = String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/ig, '[binary-redacted]')
        .replace(/\b[A-Za-z]:[\\/][^\s;；,，]+/g, '[local-path-redacted]')
        .replace(/\s+\n/g, '\n')
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function sanitizePublicPlanUserFacingText(value: unknown, maxLength = 1200): string {
    return sanitizeAgentTaskPublicPlanDisplayText(value, maxLength)
        .replace(/\blayer_hierarchy\b/ig, '图层情况')
        .replace(/\bacceptance_snapshot\b/ig, '画面快照')
        .replace(/\bdocument_info\b/ig, '文档信息')
        .replace(/读回图层结构/g, '检查图层是否真实创建')
        .replace(/读回图层/g, '检查图层')
        .replace(/读回验收快照/g, '查看画面结果')
        .replace(/读回画面/g, '查看画面')
        .replace(/读回导出文件/g, '检查导出文件')
        .replace(/执行后读回/g, '完成后复核')
        .replace(/读回/g, '复核')
        .replace(/工具执行/g, '处理')
        .replace(/受控/g, '确认范围内')
        .replace(/\s+/g, ' ')
        .trim();
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

function isAgentTaskPublicPlanRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAgentTaskPublicPlanOperationRequests(
    value: unknown,
    proposedWriteTools: string[],
    fallbackReadbackTargets: string[]
): AgentTaskPublicPlanControlledOperationRequest[] {
    if (!Array.isArray(value) || proposedWriteTools.length === 0) return [];
    const allowedToolSet = new Set(proposedWriteTools);
    const output: AgentTaskPublicPlanControlledOperationRequest[] = [];

    value.slice(0, 12).forEach((item, index) => {
        if (!isAgentTaskPublicPlanRecord(item)) return;
        const toolName = sanitizeAgentTaskPublicPlanDisplayText(item.toolName, 80).replace(/\s+/g, ' ').trim();
        if (!toolName || !allowedToolSet.has(toolName)) return;
        if (item.params === undefined || item.params === null) return;

        const readbackTargets = normalizeAgentTaskPublicPlanStringList(item.readbackTargets);
        const effectiveReadbackTargets = readbackTargets.length > 0
            ? readbackTargets
            : [...fallbackReadbackTargets];
        if (effectiveReadbackTargets.length === 0) return;

        output.push({
            operationId: sanitizeAgentTaskPublicPlanDisplayText(item.operationId, 80).replace(/\s+/g, ' ').trim()
                || `public-plan-op-${index + 1}`,
            toolName,
            params: item.params,
            paramsSummary: sanitizeAgentTaskPublicPlanDisplayText(item.paramsSummary, 240),
            readbackTargets: effectiveReadbackTargets
        });
    });

    return output;
}

function normalizeAgentTaskPublicPlanResponse(
    response: { text?: string; thinking?: string } | undefined
): AgentTaskPublicPlanPayload | null {
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
            executionPlanSummary: executionPlanSummary || undefined,
            runtimeOperationRequests: normalizeAgentTaskPublicPlanOperationRequests(
                parsed.operationRequests,
                proposedWriteTools,
                readbackTargets
            )
        };
    }

    if (isStructuredRouterLikeText(text)) return null;
    const message = sanitizeAgentTaskPublicPlanDisplayText(text);
    if (!message) return null;
    return {
        message,
        proposedWriteTools: [],
        readbackTargets: [],
        requiresUserConfirmation: true,
        runtimeOperationRequests: []
    };
}

function shouldValidateExecutablePublicPlanPayload(payload: AgentTaskPublicPlanPayload): boolean {
    const proposedWriteTools = normalizeAgentTaskPublicPlanStringList(payload.proposedWriteTools);
    return proposedWriteTools.some((toolName) => (
        toolName === 'renderLayout'
        || toolName === 'placeImage'
        || toolName === 'saveDocument'
        || toolName === 'createDocument'
    ));
}

function collectExecutablePublicPlanPayloadBlockers(payload: AgentTaskPublicPlanPayload): string[] {
    if (!shouldValidateExecutablePublicPlanPayload(payload)) return [];

    const proposedWriteTools = normalizeAgentTaskPublicPlanStringList(payload.proposedWriteTools);
    const operationRequests = Array.isArray(payload.runtimeOperationRequests)
        ? payload.runtimeOperationRequests
        : [];
    const blockers: string[] = [];
    if (proposedWriteTools.length > 0 && operationRequests.length === 0) {
        blockers.push('operationRequests 缺失，无法按确认方案创建画面。');
    }
    if (
        proposedWriteTools.includes('renderLayout')
        && !operationRequests.some((operation) => operation.toolName === 'renderLayout')
    ) {
        blockers.push('renderLayout operationRequests 缺失，无法创建版面模块。');
    }
    blockers.push(...collectAgentTaskPublicPlanOperationParamBlockers(operationRequests));
    return Array.from(new Set(blockers)).filter(Boolean);
}

function shouldRequireExecutablePublicPlanPayload(
    context: AgentContext,
    agentTaskPlan: AgentTaskPlanningContract
): boolean {
    const approval = context.agentTaskPublicPlanApproval;
    return agentTaskPlan.requestKind === 'autonomous_execution'
        && agentTaskPlan.allowedToolScope === 'write_photoshop'
        && approval?.approveGeneratedPublicPlan === true
        && approval.userConfirmed === true;
}

function collectRequiredExecutablePublicPlanBlockers(
    context: AgentContext,
    agentTaskPlan: AgentTaskPlanningContract,
    payload: AgentTaskPublicPlanPayload
): string[] {
    if (!shouldRequireExecutablePublicPlanPayload(context, agentTaskPlan)) {
        return [];
    }
    const proposedWriteTools = normalizeAgentTaskPublicPlanStringList(payload.proposedWriteTools);
    const operationRequests = Array.isArray(payload.runtimeOperationRequests)
        ? payload.runtimeOperationRequests
        : [];
    const blockers: string[] = [];
    if (proposedWriteTools.length === 0) {
        blockers.push('公开计划缺少画面创建或导出动作，不能只给文字方案。');
    }
    if (operationRequests.length === 0) {
        blockers.push('operationRequests 缺失，无法按确认方案创建画面。');
    }
    return blockers;
}

async function requestAgentTaskPublicPlan(
    context: AgentContext,
    agentTaskPlan: AgentTaskPlanningContract,
    lifecycle: AgentRequestLifecycleRecord,
    readonlyContext: AgentTaskPublicPlanReadonlyContext,
    callModel: NonNullable<ProcessOptions['callModel']>,
    callbacks: ProcessOptions['callbacks'],
    signal?: AbortSignal
): Promise<AgentTaskPublicPlanDraft | null> {
    callbacks?.onStep?.({
        kind: 'model_request',
        title: '梳理设计方向',
        detail: '正在整理画面重点、版式方向和检查方式，这一步不改动画面',
        status: 'running',
        percent: 27
    });

    const prompt = [
        '请为 DesignEcho Agent 生成执行 Photoshop 工具前可展示给用户的设计方案、处理范围和效果检查方式。',
        '这是计划，不是执行结果。',
        '只返回严格 JSON 对象，不要 Markdown。',
        '',
        'JSON 字段：',
        '{',
        '  "message": "给用户看的设计方案，简体中文，3 到 6 个短步骤，必须说明本轮尚未改动画面",',
        '  "writeToolAllowlist": ["后续如获用户确认，计划允许的 Photoshop 写工具名"],',
        '  "readbackTargets": ["每次写入后必须执行的读回检查目标，例如 layer_hierarchy 或 acceptance_snapshot"],',
        '  "requiresUserConfirmation": true,',
        '  "executionPlanSummary": "一句话说明后续处理计划，不包含本地路径或原始图片 payload",',
        '  "operationRequests": [',
        '    { "operationId": "稳定操作 ID", "toolName": "白名单内的写工具名", "params": { "仅包含可执行工具参数，不包含本地路径、编码后的图片正文、原始图片或文件 payload" }, "paramsSummary": "给用户看的参数摘要", "readbackTargets": ["该操作后的读回目标"] }',
        '  ]',
        '}',
        '',
        '硬性要求：',
        '1. message 可以展示给用户，但不要声称已经修改或导出任何内容。',
        '2. message 面向真实使用者：只说画面会呈现什么、哪些文案会放进去、哪些内容后续可编辑，以及还需要确认后才会动手。',
        '3. 不要在 message 里出现工具名、路由名、字段名、内部执行状态、日志口吻或工程解释。',
        '4. 不要使用 route、skill、executor、template authoring、deterministic、autonomous、readbackTargets、writeToolAllowlist、operationRequests 等内部词。',
        '5. 真实设计请求的 message 要优先复述用户给定的可见内容，例如标题、卖点、尺寸、风格限制；不要写“核心卖点”“标题占位”“模板类型”这类占位话术。',
        '6. writeToolAllowlist 只列出确实需要的写工具；纯分析/评审类只读任务必须返回空数组。',
        '7. readbackTargets 必须给出至少一个检查目标（如 layer_hierarchy 或 acceptance_snapshot）：写类任务用于写入后的读回验收，只读评审任务用于记录支撑分析结论的读取结果。不允许为空。',
        '8. 不要输出工具调用 XML，不要暴露私有链式思维。',
        '9. 不要输出分数、confidence、score 或没有依据的质量结论。',
        '10. operationRequests 只用于确认后的处理草稿，工具必须来自 writeToolAllowlist；不能包含本地路径、编码后的图片正文、原始图片、文件 payload 或未授权工具。',
        '11. operationRequests 是能力中立的执行信封：根据用户目标、当前文档、可用能力和只读观察结果选择最小充分动作，不预设 createDocument、renderLayout 或任何固定工具顺序。',
        '12. 不要因为任务名称、品类或“从零创建”等措辞自行补入固定画布尺寸、固定模板、默认标题、默认卖点或默认模块；缺少关键输入时应在 message 中明确待确认信息，不得伪造可执行参数。',
        '13. 每个 operationRequest 必须有稳定 operationId、白名单内 toolName、符合该工具契约的完整 params，以及至少一个写后读回目标；动作顺序由本次计划决定，并应保留为可回放序列。',
        '14. 只在用户目标确实要求且当前状态尚未满足时加入新建、置入、排版、保存或导出动作；已有文档可直接编辑时不要为了套流程重复新建文档。',
        '15. 需要项目素材时，使用工具支持的项目资源选择参数，不要写本地绝对路径、编码后的图片正文或文件 payload；多个空间写入动作必须给出可区分且不越界、不重叠的目标区域。',
        '16. 如果选择 renderLayout，params.canvas 和非空 blocks 必须完整，block role 必须符合工具 schema，可见 content 必须来自用户输入或当前上下文与观察结果，不得使用占位文案或内部规划语句。',
        '17. 如果选择 placeImage，应描述素材选择要求和目标区域；如果它与文字布局共同执行，应明确不会遮挡需要保留的可见内容。',
        '18. 如果选择 saveDocument 或导出能力，只有用户要求交付时才加入，并使用工具支持的项目相对位置/格式参数，禁止本地绝对路径。',
        '19. Skill 的专业方法、阶段结构和质量标准由对应 Skill/Capability 契约提供；本公共计划不得自行注入某个品类的阶段计划、内容顺序或方法论。',
        '20. 纯分析或信息不足的任务可以不产生写动作，但仍需给出基于只读结果的检查目标；需要写入的明确交付任务则必须给出至少一个具体写动作及其读回检查。',
        '21. 先使用只读上下文中已经提供的文档、图层、文本、画面和项目内容，再判断是否缺少用户输入。不得把工具可读取的现有内容、风格、长度或结构列成用户必须补充的前置条件；只有观察不可用、结果仍有多个高风险解释，或缺失选择会实质改变交付时才请求确认，同时不得虚构当前上下文与观察结果中不存在的产品事实。',
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
        '计划需要覆盖的必要输入：',
        agentTaskPlan.requiredInputs.join(', ') || 'none',
        '',
        '最低效果检查方式：',
        agentTaskPlan.executionPlan.verificationTargets.join(', ') || 'none',
        '',
        '当前上下文摘要：',
        ...(context.operatingContextSnapshot
            ? [compileOperatingContextPrompt(context.operatingContextSnapshot)]
            : [
                `photoshopConnected=${lifecycle.context.photoshopConnected}`,
                `hasDocument=${lifecycle.context.hasDocument}`,
                `documentName=${lifecycle.context.documentName || 'unknown'}`,
                `hasProject=${lifecycle.context.hasProject}`,
                `projectLabel=${resolveProjectLabelForPublicPlan(context.projectContext as Record<string, unknown> | undefined)}`
            ]),
        '',
        '只读上下文摘要：',
        ...formatAgentTaskPublicPlanReadonlyContext(readonlyContext)
    ].join('\n');

    try {
        let publicPlanPayload: AgentTaskPublicPlanPayload | null = null;
        let repairBlockers: string[] = [];
        const maxPublicPlanAttempts = 3;
        let modelResponseCount = 0;
        let modelCallFailureCount = 0;
        for (let attempt = 0; attempt < maxPublicPlanAttempts; attempt += 1) {
            if (signal?.aborted) {
                const abortError = new Error('agent_task_public_plan_aborted');
                abortError.name = 'AbortError';
                throw abortError;
            }
            const activePrompt = repairBlockers.length === 0
                ? prompt
                : [
                    prompt,
                    '',
                    '上一次 JSON 还不能直接创建画面，原因：',
                    ...repairBlockers.map((blocker) => `- ${blocker}`),
                    '',
                    '请只返回修正后的严格 JSON。不要解释。',
                    '必须保留用户可见 message，但补齐 operationRequests 中每个写入动作的可执行 params。',
                    '只修复上面列出的阻塞项，不要补入用户未要求的固定工具、固定顺序、默认画布、默认文案、品类模板或阶段计划。',
                    '每个 operationRequest 的 toolName 必须在 writeToolAllowlist 内，params 必须符合所选工具契约并且可回放，readbackTargets 不得为空。',
                    '如果包含 renderLayout，params.canvas 和非空 blocks 必须完整；block role 必须符合工具 schema，content 必须来自用户输入或当前上下文与观察结果，不得是占位话术或内部规划语句。',
                    '如果包含多个空间写入动作，各自目标区域必须可区分、在画布内且不互相遮挡；不要通过扩大或新建画布来掩盖未经确认的参数缺失。'
                ].join('\n');
            let response: Awaited<ReturnType<typeof callModel>>;
            try {
                response = await callModel(
                    [
                        {
                            role: 'system',
                            content: [
                                buildAgentOperatingProfilePromptSection(),
                                'Return only strict JSON for a public user-visible design plan and controlled execution boundary.',
                                'Do not call tools. Do not reveal private chain-of-thought.'
                            ].join('\n')
                        },
                        { role: 'user', content: activePrompt }
                    ],
                    {
                        temperature: repairBlockers.length === 0 ? 0.2 : 0.1,
                        // 计划 JSON 含多步骤 message + 工具白名单 + operationRequests 数组，
                        // 700 tokens 必然截断（实测：计划卡片「步骤待补充/缺少关键信息」全因截断）
                        maxTokens: 2600,
                        purpose: 'agent_task_public_plan',
                        modelCandidateOffset: attempt,
                        stream: false
                    }
                );
                modelResponseCount += 1;
            } catch (error) {
                if (isAgentTaskPublicPlanAbortError(error, signal)) throw error;
                modelCallFailureCount += 1;
                console.warn('[DesignAgentEngine] public plan model candidate unavailable:', {
                    attempt: attempt + 1,
                    maxAttempts: maxPublicPlanAttempts
                });
                if (attempt < maxPublicPlanAttempts - 1) {
                    callbacks?.onStep?.({
                        kind: 'model_response',
                        title: '切换备用模型',
                        detail: '当前模型没有返回设计方案，正在尝试下一个可用候选。',
                        status: 'running',
                        percent: 28
                    });
                    continue;
                }
                break;
            }
            publicPlanPayload = normalizeAgentTaskPublicPlanResponse(response);
            repairBlockers = publicPlanPayload
                ? [
                    ...collectRequiredExecutablePublicPlanBlockers(context, agentTaskPlan, publicPlanPayload),
                    ...collectExecutablePublicPlanPayloadBlockers(publicPlanPayload)
                ]
                : ['模型没有返回可展示且可执行的计划 JSON。'];
            repairBlockers = Array.from(new Set(repairBlockers)).filter(Boolean);
            if (repairBlockers.length > 0) {
                console.warn('[DesignAgentEngine] public plan attempt not executable:', {
                    attempt: attempt + 1,
                    maxAttempts: maxPublicPlanAttempts,
                    hasPayload: Boolean(publicPlanPayload),
                    blockers: repairBlockers.slice(0, 8)
                });
            }
            if (repairBlockers.length > 0 && attempt < maxPublicPlanAttempts - 1) {
                callbacks?.onStep?.({
                    kind: 'model_response',
                    title: '补齐画面创建条件',
                    detail: '设计方案里缺少可直接创建画面的版面信息，正在让模型补齐。',
                    status: 'running',
                    percent: 28
                });
                continue;
            }
            break;
        }
        if (modelResponseCount === 0 && modelCallFailureCount === maxPublicPlanAttempts) {
            callbacks?.onStep?.({
                kind: 'model_response',
                title: '设计方向生成失败',
                detail: '当前模型服务和备用候选都未返回设计方案；本轮不会改动画面。',
                status: 'error',
                percent: 28,
                issue: 'agent_task_public_plan_model_unavailable'
            });
            throw new AgentTaskPublicPlanModelUnavailableError();
        }
        if (publicPlanPayload && repairBlockers.length > 0) {
            callbacks?.onStep?.({
                kind: 'model_response',
                title: '画面创建条件不足',
                detail: '模型多次整理后仍存在图文重叠、文案或参数问题；本轮不会改动画面。',
                status: 'error',
                percent: 28,
                issue: 'agent_task_public_plan_unresolved_blockers'
            });
            return null;
        }
        if (!publicPlanPayload) {
            callbacks?.onStep?.({
                kind: 'model_response',
                title: '设计方向不可用',
                detail: '模型没有返回可直接展示的设计方案；本轮不会改动画面。',
                status: 'error',
                percent: 28,
                issue: 'agent_task_public_plan_unavailable'
            });
            return null;
        }
        callbacks?.onStep?.({
            kind: 'model_response',
            title: '设计方向',
            detail: publicPlanPayload.message,
            status: 'success',
            percent: 29
        });
        callbacks?.onStatus?.('已整理设计方向，尚未改动画面。');
        // 读回目标不能依赖模型自觉：模型偶发返回空数组会让计划卡死在「待补充」
        // 且用户无法确认（计划 status 停在 blocked 而非 pending_user_confirmation）。
        // 三级来源：模型给的 → 任务契约 verificationTargets → 通用验收检查。
        // autonomous 设计执行任务的 verificationTargets 常为空，必须有最终检查项，
        // 否则「确认计划」找不到 pending plan，批准链断裂落回对话（实测 C-1188 主图）。
        const readbackTargets = publicPlanPayload.readbackTargets.length > 0
            ? publicPlanPayload.readbackTargets
            : agentTaskPlan.executionPlan.verificationTargets.length > 0
                ? [...agentTaskPlan.executionPlan.verificationTargets]
                : ['acceptance_snapshot', 'layer_hierarchy'];
        const publicPlan: AgentTaskPublicPlan = {
            status: 'ready',
            source: 'model',
            canExecuteTools: false,
            message: publicPlanPayload.message,
            proposedWriteTools: publicPlanPayload.proposedWriteTools,
            readbackTargets,
            requiresUserConfirmation: true,
            executionPlanSummary: publicPlanPayload.executionPlanSummary,
            requiredInputs: agentTaskPlan.requiredInputs,
            verificationTargets: agentTaskPlan.executionPlan.verificationTargets,
            generatedAt: new Date().toISOString()
        };
        return {
            publicPlan,
            runtimeOperationRequests: publicPlanPayload.runtimeOperationRequests
        };
    } catch (error) {
        if (error instanceof AgentTaskPublicPlanModelUnavailableError
            || isAgentTaskPublicPlanAbortError(error, signal)) {
            throw error;
        }
        console.warn('[DesignAgentEngine] agent task public plan failed:', error);
        callbacks?.onStep?.({
            kind: 'model_response',
            title: '设计方向生成失败',
            detail: '模型没有整理出可展示的设计方案；本轮不会改动画面。',
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
    return withAssistantReplyOrigin(
        {
            success: false,
            message,
            error,
            data: {
                agentTaskPlan
            }
        },
        deterministicBlockerReplyOrigin(`agent-task-plan:${agentTaskPlan.status}`)
    );
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

function attachAgentReActObservation(
    result: AgentResult,
    observation: AgentReActObservation
): AgentResult {
    const currentData = result.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : {};
    return {
        ...result,
        data: {
            ...currentData,
            agentReActObservation: observation
        }
    };
}

async function buildConversationalAgentResult(
    lightweightIntent: LightweightIntent,
    context: AgentContext,
    message: string,
    options?: {
        callModel?: NonNullable<ProcessOptions['callModel']>;
        assistantReplyOrigin?: AssistantReplyOrigin;
    }
): Promise<AgentResult> {
    const visibleMessage = sanitizeUserVisibleAssistantBodyText(message).trim();
    if (lightweightIntent !== 'continuation') {
        if (visibleMessage) {
            return withAssistantReplyOrigin(
                { success: true, message: visibleMessage },
                options?.assistantReplyOrigin || uiStatusReplyOrigin('conversational:missing-origin')
            );
        }

        return withAssistantReplyOrigin(
            {
                success: false,
                message: resolveConversationalUnavailableMessage(lightweightIntent, context),
                error: 'empty_conversational_reply'
            },
            uiStatusReplyOrigin('conversational:unavailable')
        );
    }

    const agentResumableTaskContract = buildAgentResumableTaskContract({
        userInput: context.userInput,
        conversationHistory: context.conversationHistory
    });
    const agentResumeExecutionPolicy = buildAgentResumeExecutionPolicy(agentResumableTaskContract);
    const operatingPhotoshopConnected = resolveOperatingPhotoshopConnection(context.operatingContextSnapshot)
        // 快照「说不出」(freshness !== 'current') 与「说没连」是两回事，
        // 前者必须回落到实时连接状态，否则会被下游折成 false 产出未连接硬阻断。
        ?? context.isPluginConnected;
    const operatingPhotoshopHasDocument = resolveOperatingPhotoshopDocumentPresence(context.operatingContextSnapshot)
        ?? context.photoshopContext?.hasDocument;
    const agentResumeContextGate = buildAgentResumeContextGate({
        policy: agentResumeExecutionPolicy,
        photoshopConnected: operatingPhotoshopConnected,
        hasDocument: operatingPhotoshopHasDocument,
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
            context: agentResumeReadonlyContextExecutor.context
        });
    }

    let agentResumePlanning = buildAgentResumePlanningResult({
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
            agentResumePlanning = buildAgentResumePlanningResult({
                contract: agentResumableTaskContract,
                policy: agentResumeExecutionPolicy,
                gate: agentResumeContextGate,
                refreshRun: agentResumeContextRefreshRun,
                readonlyExecutor: agentResumeReadonlyContextExecutor,
                modelPlanText,
                modelError: modelPlanText ? undefined : new Error('模型未返回恢复计划文本。')
            });
        } catch (error) {
            agentResumePlanning = buildAgentResumePlanningResult({
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

    return withAssistantReplyOrigin(
        {
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
        },
        options?.assistantReplyOrigin || uiStatusReplyOrigin('conversational:continuation:local-status')
    );
}

function mapConversationalFailureKind(
    failure?: ConversationalModelFailure
): Extract<
    ConversationalModelFailureKind,
    'auth' | 'billing' | 'model_access' | 'rate_limit' | 'network' | 'timeout' | 'protocol' | 'service_unavailable' | 'unknown'
> {
    if (
        failure?.kind === 'auth'
        || failure?.kind === 'billing'
        || failure?.kind === 'model_access'
        || failure?.kind === 'rate_limit'
        || failure?.kind === 'network'
        || failure?.kind === 'timeout'
        || failure?.kind === 'service_unavailable'
        || failure?.kind === 'protocol'
    ) {
        return failure.kind;
    }
    return 'unknown';
}

function buildConversationalUnavailableStatusResult(
    lightweightIntent: LightweightIntent,
    context: AgentContext,
    failure: ConversationalModelFailure | undefined,
    options?: {
        error?: 'Conversational reply unavailable' | 'conversational_reply_unavailable';
    }
): AgentResult {
    return withAssistantReplyOrigin(
        {
            success: false,
            message: resolveConversationalUnavailableMessage(
                lightweightIntent,
                context,
                mapConversationalFailureKind(failure),
                failure?.failedModelLabel
            ),
            error: options?.error || 'Conversational reply unavailable',
            data: {
                ...(failure ? { conversationalModelFailure: failure } : {})
            }
        },
        uiStatusReplyOrigin('conversational:unavailable')
    );
}

function buildDesignPreflightContextMessage(preflight: AgentDesignExecutionPreflight): string {
    if (!preflight.designIntelligencePlan && preflight.requiredInputs.length > 0) {
        return '当前 Skill 已声明结构化输入要求；实际素材、配置、目标和结果读回由该 Skill 在执行时校验。';
    }
    if (preflight.status === 'needs_model_design_decision') {
        return '设计方向仍需补充；已把缺口交给当前 Skill 继续规划，不会在这里终止任务。';
    }
    if (preflight.status === 'needs_visual_observation') {
        return '当前只确认了素材可用性，尚未形成具体视觉理解；当前 Skill 可继续读取或观察图片。';
    }
    if (preflight.status === 'needs_planner_context') {
        return '上游规划上下文尚未完整；当前 Skill 可继续刷新上下文或重新规划。';
    }
    if (preflight.status === 'not_applicable') {
        return '当前任务不需要通用设计上下文整理。';
    }
    return '设计上下文已整理并交给当前 Skill；具体写入仍由工具执行点与 Policy 检查。';
}

function buildDesignPreflightProjectContext(context: AgentContext) {
    const projectContext = context.projectContext || {};
    return {
        ...projectContext,
        projectImageCount: Number(projectContext.projectImageCount || 0),
        attachmentImageCount: countContextImageInputs(context)
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
}> {
    if (!shouldApplyAgentDesignExecutionPreflight(options.skillId)) {
        return { params: options.params };
    }

    const sharedDefaultsMode = options.mode === 'execute' || options.mode === 'inspect'
        ? options.mode
        : undefined;
    let params = applySharedSkillParamDefaults({
        skillId: options.skillId,
        userInput: context.userInput,
        mode: sharedDefaultsMode,
        params: options.params || {}
    });
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
            detail: '正在补齐设计目标、配色、选图和验收标准，然后继续制作',
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
        kind: preflight.status === 'context_ready' || preflight.status === 'not_applicable'
            ? 'tool_planned'
            : 'model_response',
        title: preflight.status === 'context_ready' || preflight.status === 'not_applicable'
            ? '设计上下文已整理'
            : '设计上下文待补充',
        detail: buildDesignPreflightContextMessage(preflight),
        status: 'success',
        percent: 31
    });

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
        warnings?: string[];
        observations?: Array<{ source: string; summary: string }>;
        agentTaskPlanOverride?: AgentTaskPlanningContract;
        runtimeInteractiveReentry?: RuntimeInteractiveReentry;
        adoptRuntimeInteractiveReentry?: () => boolean;
        /** 仅由已确认制作语义、结构化 continuation 或受控 owner 显式签发。 */
        requiresTaskProgress?: boolean;
        /** 检查只要求观察；明确制作才要求交付动作。 */
        taskProgressObligation?: AgentTaskProgressObligation;
    }
): Promise<AgentResult> {
    const executionKind = options.executionKind || 'deterministic_skill';
    const lifecycle = buildLifecycle(context, {
        routeSource: options.routeSource,
        route: options.route || 'skill_execution',
        skillId: options.skillId,
        mode: options.mode,
        skillParams: options.params,
        intentSummary: options.intentSummary,
        reason: options.reason,
        executionKind,
        warnings: options.warnings,
        observations: options.observations
    });
    // approveGeneratedPublicPlan 是显式选择的受控执行模式，因此强制生成能力中立 public-plan。
    // 普通 autonomous 请求是否直进循环由 executionAuthorization 决定，不再依赖设计品类信号。
    const shouldRunGeneratedPublicPlan = context.agentTaskPublicPlanApproval?.approveGeneratedPublicPlan === true;
    const hasApprovedPublicPlan = context.agentTaskPublicPlanApproval?.userConfirmed === true
        && !shouldRunGeneratedPublicPlan;
    const hasStructuredAutonomousOwner = Boolean(
        options.params?.runtimeSelectedSkillHandoff
        || options.params?.declaredSkillId
        || options.params?.declaredTaskType
        || options.params?.declaredWorkMode
        || options.params?.internalResumeRequest
        || Object.prototype.hasOwnProperty.call(options.params || {}, 'runtimeAllowedWriteTools')
    );
    const requiresTaskProgress = options.requiresTaskProgress ?? (
        executionKind === 'deterministic_skill'
        || hasApprovedPublicPlan
        || hasStructuredAutonomousOwner
    );
    const taskProgressObligation = requiresTaskProgress
        ? options.taskProgressObligation || 'delivery'
        : 'none';
    const planning = options.agentTaskPlanOverride
        ? {
            intentControlPlane: options.intentControlPlane || buildAgentIntentControlPlaneDecision({
                userInput: context.userInput,
                hasImageInput: hasContextImageInput(context),
                hasDocument: context.photoshopContext?.hasDocument,
                photoshopConnected: context.isPluginConnected
            }),
            agentTaskPlan: options.agentTaskPlanOverride
        }
        : buildAgentTaskPlanForLifecycle(
            lifecycle,
            options.intentControlPlane,
            shouldRunGeneratedPublicPlan,
            requiresTaskProgress,
            taskProgressObligation
        );
    // Photoshop 未连接时对「需要 Photoshop 的任务」一律诚实前置失败：不进循环、不生成
    // 「让我检查一下文档状态」这类承诺动作却什么都做不了的漂亮话（真机：PS 断连时详情页任务
    // 连答两轮"我先检查一下"、零执行）。做不到就直说做不到，并指出用户该做什么。
    // 只拦「未连接」这一种确定性阻断；「已连接但没有打开文档」不在此拦——从零设计本就应当
    // 先建画布（见 R2 空画布起点修复），仍按原有 deterministic_skill + read_only 条件处理。
    const photoshopConnectionBlocked = capabilityBlocksExecution(resolveDeclaredCapabilityVerdict({
        declared: lifecycle.context.photoshopConnected,
        subjectLabel: '当前 Photoshop 运行时'
    }, '连接能力'));
    const blockedByPhotoshopDisconnected = lifecycle.execution.requiresPhotoshop
        && photoshopConnectionBlocked;
    if (
        blockedByPhotoshopDisconnected
        || (
            lifecycle.execution.kind === 'deterministic_skill'
            && planning.intentControlPlane.toolScope === 'read_only'
            && lifecycle.execution.requiresPhotoshop
            && lifecycle.execution.canStart === false
        )
    ) {
        const status = photoshopConnectionBlocked
            ? 'blocked_missing_photoshop_connection'
            : 'blocked_missing_document';
        const message = getInternalAgentStatusPublicMessage(status)
            || (photoshopConnectionBlocked
                ? 'Photoshop 当前未连接；本轮没有调用画布工具。'
                : '需要先打开要检查的 Photoshop 文档；本轮没有调用画布工具。');
        options.callbacks?.onStep?.({
            kind: 'verification',
            title: status === 'blocked_missing_photoshop_connection'
                ? 'Photoshop 还没连上'
                : '当前无法读取画布',
            detail: message,
            status: 'error',
            issue: status
        });
        return attachLifecycle(
            withAssistantReplyOrigin(
                {
                    success: false,
                    message,
                    error: status
                },
                deterministicBlockerReplyOrigin(`lifecycle:${status}`)
            ),
            lifecycle,
            planning.intentControlPlane,
            planning.agentTaskPlan
        );
    }
    const allowConfirmedAutonomousRuntime = !shouldRunGeneratedPublicPlan
        && isConfirmedAutonomousTask(planning.intentControlPlane, options.skillId);
    // ready_for_model_planning 只描述 Agent 需要在当前 ReAct 循环内形成路径，不是审批状态。
    // 弱授权请求可以进入循环读取、推理或追问；写入仍由 intent control plane 与执行点 HITL 拦截。
    const allowSameRunAutonomousModelPlanning = !shouldRunGeneratedPublicPlan
        && options.skillId === 'autonomous-agent'
        && planning.agentTaskPlan.status === 'ready_for_model_planning'
        && planning.agentTaskPlan.executionPlan.requiresUserApproval === false;
    // 用户已确认公开计划的接回执行不再二次卡计划门禁——否则批准→接回→再出新计划
    // 形成确认死循环；受控约束由批准白名单与运行时执行点契约继续保证。
    if (shouldBlockExecutionByAgentTaskPlan(planning.agentTaskPlan)
        && !allowConfirmedAutonomousRuntime
        && !allowSameRunAutonomousModelPlanning
        && !hasApprovedPublicPlan) {
        if (
            planning.agentTaskPlan.status === 'ready_for_model_planning'
            && planning.agentTaskPlan.executionPlan.requiresUserApproval === true
            && options.callModel
        ) {
            const readonlyContext = await buildAgentTaskPublicPlanReadonlyContext({
                readonlyToolHandlers: context.resumeReadonlyToolHandlers
            });
            let publicPlanDraft: AgentTaskPublicPlanDraft | null;
            try {
                publicPlanDraft = await requestAgentTaskPublicPlan(
                    context,
                    planning.agentTaskPlan,
                    lifecycle,
                    readonlyContext,
                    options.callModel,
                    options.callbacks,
                    options.signal
                );
            } catch (error) {
                if (isAgentTaskPublicPlanAbortError(error, options.signal)) throw error;
                if (!(error instanceof AgentTaskPublicPlanModelUnavailableError)) throw error;
                const message = '模型服务暂时未能生成设计方案，本轮没有修改 Photoshop。请重试；如果仍失败，请检查模型连接或切换可用模型。';
                options.callbacks?.onStatus?.('模型服务暂时不可用，本轮未改动画面。');
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        {
                            success: false,
                            message,
                            error: 'agent_task_public_plan_model_unavailable',
                            data: {
                                agentTaskPlan: planning.agentTaskPlan,
                                agentTaskPublicPlanReadonlyContext: readonlyContext,
                                agentTaskPublicPlanFailure: {
                                    kind: 'model_call_failed',
                                    attemptedModelCandidates: 3,
                                    photoshopModified: false
                                }
                            }
                        },
                        uiStatusReplyOrigin('agent-task-public-plan:model-call-failed')
                    ),
                    lifecycle,
                    planning.intentControlPlane,
                    planning.agentTaskPlan
                );
            }
            if (publicPlanDraft) {
                    const { publicPlan, runtimeOperationRequests } = publicPlanDraft;
                    const publicPlanExecutionRequest = buildAgentTaskPublicPlanExecutionRequest({
                    agentTaskPlan: planning.agentTaskPlan,
                    designDimensionSpec: context.designDimensionSpec,
                    publicPlan,
                    runtimeAllowedWriteTools: context.agentTaskPublicPlanApproval?.allowedWriteTools
                        || [...DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST],
                    userConfirmed: context.agentTaskPublicPlanApproval?.userConfirmed,
                    enableControlledExecutionRequest: context.agentTaskPublicPlanApproval?.enableControlledExecutionRequest,
                    requestId: context.agentTaskPublicPlanApproval?.requestId,
                    runtimeOperationRequests: context.agentTaskPublicPlanApproval?.runtimeOperationRequests
                        || runtimeOperationRequests
                });
                const generatedPublicPlanRun = await runGeneratedPublicPlanIfApproved({
                    context,
                    planning,
                    lifecycle,
                    publicPlan,
                    executionRequest: publicPlanExecutionRequest,
                    repairSkillId: options.skillId,
                    repairParams: options.params,
                    signal: options.signal,
                    callbacks: options.callbacks,
                    callModel: options.callModel
                });
                if (generatedPublicPlanRun) return generatedPublicPlanRun;
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
                    planning.intentControlPlane,
                    planning.agentTaskPlan
                );
            }
            if (isExplicitProjectContextAutonomousDeliveryFallback(context, planning.agentTaskPlan, options.skillId)) {
                options.callbacks?.onStep?.({
                    kind: 'model_response',
                    title: '改为边做边检查',
                    detail: '多轮方案没有稳定通过画面创建检查，改由 Agent 在受控范围内边处理边复核。',
                    status: 'running',
                    percent: 30
                });
                options.callbacks?.onStatus?.('公开方案没有稳定通过，改由 Agent 边处理边复核。');
                const fallbackResult = await executeSkillWithExecutor(options.skillId, {
                    params: options.params,
                    callbacks: options.callbacks,
                    signal: options.signal,
                    context,
                    agentTaskPlan: planning.agentTaskPlan,
                    runtimeInteractiveReentry: options.runtimeInteractiveReentry,
                    adoptRuntimeInteractiveReentry: options.adoptRuntimeInteractiveReentry
                });
                const fallbackResultWithOrigin = await mediateSkillResultUserReplyWithModel({
                    result: fallbackResult,
                    skillId: options.skillId,
                    context,
                    callModel: options.callModel
                });
                const fallbackResultWithObservation = attachAgentReActObservation(
                    fallbackResultWithOrigin,
                    buildAgentReActObservationFromSkillResult({
                        skillId: options.skillId,
                        result: fallbackResultWithOrigin
                    })
                );
                return attachAgentDesignExecutionPreflight(
                    attachLifecycle(
                        fallbackResultWithObservation,
                        lifecycle,
                        planning.intentControlPlane,
                        planning.agentTaskPlan
                    ),
                    options.agentDesignExecutionPreflight
                );
            }
        }
        return attachLifecycle(
            buildAgentTaskPlanBlockedResult(planning.agentTaskPlan, options.callbacks),
            lifecycle,
            planning.intentControlPlane,
            planning.agentTaskPlan
        );
    }
    const result = await executeSkillWithExecutor(options.skillId, {
        params: options.params,
        callbacks: options.callbacks,
        signal: options.signal,
        context,
        agentTaskPlan: planning.agentTaskPlan,
        runtimeInteractiveReentry: options.runtimeInteractiveReentry,
        adoptRuntimeInteractiveReentry: options.adoptRuntimeInteractiveReentry
    });
    const resultWithOrigin = await mediateSkillResultUserReplyWithModel({
        result,
        skillId: options.skillId,
        context,
        callModel: options.callModel
    });
    const resultWithObservation = attachAgentReActObservation(
        resultWithOrigin,
        buildAgentReActObservationFromSkillResult({
            skillId: options.skillId,
            result: resultWithOrigin
        })
    );
    return attachAgentDesignExecutionPreflight(
        attachLifecycle(
            resultWithObservation,
            lifecycle,
            planning.intentControlPlane,
            planning.agentTaskPlan
        ),
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

    return executeSkillWithLifecycle(context, {
        ...options,
        params: prepared.params,
        warnings: [
            ...(options.warnings || []),
            ...(prepared.preflight?.warnings || [])
        ],
        observations: [
            ...(options.observations || []),
            ...(prepared.preflight ? [{
                source: 'agent-design-execution-preflight',
                summary: `status=${prepared.preflight.status}; skill=${options.skillId}`
            }] : [])
        ],
        agentDesignExecutionPreflight: prepared.preflight
    });
}

export class DesignAgentEngine {
    async run(context: AgentContext, options: ProcessOptions): Promise<AgentResult> {
        const { callModel, callbacks, signal } = options;

        // ═══════════════════════════════════════════════════════════════
        // Agent-first topology (structured owners first, ordinary language has one model entry)
        //   1. System cancel
        //   2. Persisted interactive continuation (ledger-owned)
        //   3. Internal resume (source identity validated)
        //   4. Public plan approval (sourceMessageId + requestId owned)
        //   5. No model available → explicit compatibility path
        //   6. Ordinary natural language → semantic hint → autonomous Agent
        // Topic keywords never short-circuit ordinary language. Capability pauses and user deny-only
        // constraints are enforced at capability resolution and Tool execution points.
        // ═══════════════════════════════════════════════════════════════

        // ── Route 1: System cancel ──
        if (signal?.aborted) {
            callbacks?.onStep?.({
                kind: 'stopped',
                title: '任务已取消',
                status: 'error',
                issue: 'cancelled'
            });
            return attachLifecycle(
                withAssistantReplyOrigin(
                    { success: false, cancelled: true, message: '任务已取消。' },
                    uiStatusReplyOrigin('system:cancelled')
                ),
                buildLifecycle(context, {
                    routeSource: 'system',
                    route: 'cancelled',
                    reason: '用户或系统取消了本次请求。'
                })
            );
        }

        // ── Route 2: persisted interactive continuation ──
        // 卡片确认不是一条新自然语言任务。它只能续接操作账本中冻结的精确 Skill 操作，
        // 因此不经过意图分类、路由模型或 Capability 重发现；Skill 注册表的业务预检仍会重新执行。
        if (context.interactiveContinuationRequest) {
            const request = context.interactiveContinuationRequest;
            const continuationOperationIdentity = {
                ...request,
                ...(context.conversationId ? { conversationId: context.conversationId } : {}),
                ...(context.projectContext?.projectId
                    ? { projectId: context.projectContext.projectId }
                    : {}),
                ...(context.projectContext?.projectPath
                    ? { projectPath: context.projectContext.projectPath }
                    : {})
            };
            const ledgerResult = await getInteractiveContinuationOperation(request.continuationId);
            if (!ledgerResult.record?.submission || !ledgerResult.record.continuation) {
                const message = ledgerResult.message || '确认操作没有可恢复的持久化记录，本轮不会写入 Photoshop。';
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        {
                            success: false,
                            message,
                            error: ledgerResult.code || 'interactive_continuation_operation_missing'
                        },
                        deterministicBlockerReplyOrigin('interactive-continuation:ledger-missing')
                    ),
                    buildLifecycle(context, {
                        routeSource: 'intent_control_plane',
                        route: 'direct_response',
                        intentSummary: '交互确认操作缺少可恢复记录。',
                        reason: '持久化操作账本没有返回完整 continuation envelope。',
                        executionKind: 'none',
                        blockers: [message]
                    })
                );
            }
            const pauseRevision = resolvePendingInteractiveContinuationPauseRevision(
                ledgerResult.record.continuation
            );
            const expectedPhotoshopDocumentId = Number(
                ledgerResult.record.continuation.scope.photoshopDocumentId
                || pauseRevision?.documentId
                || ledgerResult.record.continuation.taskRunBinding?.expectedRevision?.documentId
                || 0
            );
            const runtimeOwnsPhotoshopState = Boolean(
                ledgerResult.record.continuation.taskRunBinding
            );
            const shouldReadFreshPhotoshopContext = runtimeOwnsPhotoshopState
                || expectedPhotoshopDocumentId > 0;
            const freshPhotoshopContext = shouldReadFreshPhotoshopContext
                ? await getPhotoshopContext({ signal })
                : undefined;
            const currentPhotoshopDocumentId = freshPhotoshopContext?.hasDocument
                ? freshPhotoshopContext.documentId
                : undefined;
            const resolution = resolveInteractiveContinuationOperationRequest({
                continuation: ledgerResult.record.continuation,
                submission: ledgerResult.record.submission,
                request,
                conversationId: context.conversationId,
                conversationBranchId: context.conversationBranchId,
                projectId: context.projectContext?.projectId,
                projectPath: context.projectContext?.projectPath,
                photoshopDocumentId: currentPhotoshopDocumentId,
                photoshopHistoryStateRef: freshPhotoshopContext?.historyStateRef,
                photoshopStateOwner: runtimeOwnsPhotoshopState
                    ? 'runtime_session'
                    : 'continuation_envelope'
            });
            if (resolution.status === 'rejected') {
                const message = [
                    resolution.message,
                    '确认操作尚未取得执行权，卡片会保留；恢复原对话、项目和 Photoshop 文档后可以再次确认。'
                ].join('\n');
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        {
                            success: false,
                            message,
                            error: resolution.code
                        },
                        deterministicBlockerReplyOrigin('interactive-continuation:rejected')
                    ),
                    buildLifecycle(context, {
                        routeSource: 'intent_control_plane',
                        route: 'direct_response',
                        intentSummary: '交互确认续跑校验未通过。',
                        reason: '账本 envelope、卡片提交、Photoshop 文档或项目作用域不匹配。',
                        executionKind: 'none',
                        blockers: [message]
                    })
                );
            }

            const runtimeResume = prepareRuntimeInteractiveResume({
                continuationId: resolution.continuation.id,
                taskRunBinding: resolution.taskRunBinding,
                photoshopObservation: buildRuntimeInteractivePhotoshopObservation(
                    freshPhotoshopContext
                )
            });
            if (runtimeResume.status === 'not_applicable') {
                const message = '这张历史确认卡缺少可恢复的 TaskRun 身份，本轮没有执行。请重新发起当前任务。';
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        {
                            success: false,
                            message,
                            error: 'runtime_interactive_task_run_binding_missing'
                        },
                        deterministicBlockerReplyOrigin('interactive-continuation:runtime-binding-missing')
                    ),
                    buildLifecycle(context, {
                        routeSource: 'intent_control_plane',
                        route: 'direct_response',
                        intentSummary: '交互确认缺少可恢复的 TaskRun 身份。',
                        reason: '未绑定的历史卡片不能伪造新 Runtime 或直接重放 Skill。',
                        executionKind: 'none',
                        blockers: [message]
                    })
                );
            }
            if (runtimeResume.status === 'checkpoint_missing'
                || runtimeResume.status === 'resume_rejected') {
                const checkpointMissing = runtimeResume.status === 'checkpoint_missing';
                if (checkpointMissing
                    && ledgerResult.record.status === 'claimed'
                    && resolution.taskRunBinding) {
                    await settleInteractiveContinuationOperation({
                        ...continuationOperationIdentity,
                        status: 'failed',
                        mutationState: 'none',
                        summary: '原 Runtime checkpoint 已失效；确认操作未进入 Skill 执行。'
                    });
                }
                let message = '当前 Photoshop 画面已经和确认前不同，我没有重放旧操作。请重新查看当前画面后再发起任务。';
                if (checkpointMissing) {
                    message = '这次确认对应的原任务运行状态已经失效，我没有继续修改 Photoshop。请重新发起当前任务；已有画面会保留。';
                } else if (runtimeResume.code === 'runtime_interactive_checkpoint_busy') {
                    message = '这张确认卡正在由原任务继续处理，本轮没有重复执行。';
                }
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        { success: false, message, error: runtimeResume.code },
                        deterministicBlockerReplyOrigin(`interactive-continuation:${checkpointMissing ? 'runtime-checkpoint-missing' : 'runtime-resume-rejected'}`)
                    ),
                    buildLifecycle(context, {
                        routeSource: 'intent_control_plane',
                        route: 'direct_response',
                        intentSummary: checkpointMissing
                            ? '交互确认缺少可恢复的原 Runtime 状态。'
                            : '原 TaskRun 没有通过同代恢复校验。',
                        reason: runtimeResume.code,
                        executionKind: 'none',
                        blockers: [message]
                    })
                );
            }

            callbacks?.onStep?.({
                kind: 'observation',
                title: '已承接确认内容',
                detail: '已核对本次确认与原任务，正在继续后续处理。',
                status: 'success',
                percent: 8,
                source: 'agent_runtime',
                audience: 'user',
                visibility: 'user_process'
            });
            const continuationRun = await runRuntimeInteractiveContinuation({
                requestId: context.requestId,
                operationIdentity: continuationOperationIdentity,
                resolution,
                preparation: runtimeResume,
                executeSkill: async (runtimeSkillExecutionLineage) => await executeSkillTool(
                    resolution.skillId,
                    resolution.params,
                    {
                        callbacks,
                        signal,
                        context,
                        trustedInteractiveContinuation: resolution,
                        runtimeSkillExecutionLineage,
                        agentTaskPlan: resolution.agentTaskPlan as AgentTaskPlanningContract | undefined
                    }
                ),
                readPhotoshopObservation: async () => (
                    buildRuntimeInteractivePhotoshopObservation(
                        await getPhotoshopContext({ signal })
                    )
                ),
                executeAgentReentry: async ({ reentry, reentryTask, adopt }) => {
                    const resumedContext: AgentContext = {
                        ...context,
                        userInput: reentryTask,
                        interactiveContinuationRequest: undefined
                    };
                    const autonomousDecision = buildAutonomousExecutionDecisionForEngine(
                        '用户确认已由原 Workflow 消费；以同一 RuntimeSession 和 TaskRun 身份把非终态 handoff 交还 Agent。'
                    );
                    callbacks?.onStep?.({
                        kind: 'observation',
                        title: '确认完成，继续制作',
                        detail: '已沿用刚才的任务进度和确认内容，继续完成后续画面。',
                        status: 'running',
                        percent: 12,
                        source: 'agent_runtime',
                        audience: 'user',
                        visibility: 'user_process'
                    });
                    return await executeSkillWithLifecycle(resumedContext, {
                        skillId: 'autonomous-agent',
                        params: {
                            ...buildAutonomousSkillParams(resumedContext, autonomousDecision),
                            userTask: reentryTask
                        },
                        callbacks,
                        signal,
                        routeSource: 'intent_control_plane',
                        route: 'autonomous_agent',
                        executionKind: 'autonomous_agent',
                        intentSummary: '交互确认后继续同一 Agent TaskRun。',
                        reason: '结构化 handoff 已通过 operation ledger、卡片、项目、文档和 RuntimeSession 同代校验。',
                        callModel,
                        intentControlPlane: autonomousDecision,
                        agentTaskPlanOverride: resolution.agentTaskPlan as AgentTaskPlanningContract | undefined,
                        runtimeInteractiveReentry: reentry,
                        adoptRuntimeInteractiveReentry: adopt,
                        requiresTaskProgress: true,
                        taskProgressObligation: 'delivery'
                    });
                }
            });
            if (continuationRun.kind === 'agent_result') {
                const autonomousData = continuationRun.result.data
                    && typeof continuationRun.result.data === 'object'
                    ? continuationRun.result.data as Record<string, unknown>
                    : {};
                return {
                    ...continuationRun.result,
                    data: {
                        ...autonomousData,
                        interactiveContinuationResolution: {
                            version: 'interactive-continuation-resolution/v0',
                            continuationId: resolution.continuation.id,
                            sourceMessageId: resolution.sourceMessageId,
                            cardId: resolution.submission.cardId,
                            status: continuationRun.continuationStatus,
                            resumedExistingTaskRun: continuationRun.adopted,
                            taskRunId: resolution.taskRunBinding?.taskRunId
                        }
                    }
                };
            }
            if (continuationRun.kind === 'blocked') {
                let message = continuationRun.message;
                let replyOrigin = 'interactive-continuation:task-run-writer-rejected';
                let intentSummary = '交互确认操作未取得 TaskRun 单写者身份。';
                let reason = '当前文档已有其他写者，或确认卡绑定的历史版本已失效。';
                if (continuationRun.phase === 'ledger_begin') {
                    replyOrigin = 'interactive-continuation:ledger-begin-rejected';
                    intentSummary = '交互确认操作未取得唯一执行权。';
                    reason = '持久化操作账本拒绝了重复、冲突或不确定状态。';
                } else if (continuationRun.phase === 'ledger_settlement') {
                    const mutationState = continuationRun.mutationState || 'unknown';
                    message = buildInteractiveContinuationSettlementFailureMessage(
                        mutationState,
                        continuationRun.message,
                        continuationRun.operationSucceeded === true
                    );
                    replyOrigin = mutationState === 'none'
                        ? 'interactive-continuation:ledger-settlement-failed-without-mutation'
                        : 'interactive-continuation:ledger-settlement-unknown';
                    intentSummary = mutationState === 'none'
                        ? '交互确认操作失败且没有产生 Photoshop 修改，但账本未完成结算。'
                        : '交互确认操作结算状态不确定。';
                    reason = mutationState === 'none'
                        ? '运行结果已明确报告零修改；仅持久化结算失败。'
                        : '执行结果与持久化账本未能原子收敛，禁止自动重放。';
                }
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        { success: false, message, error: continuationRun.code },
                        deterministicBlockerReplyOrigin(replyOrigin)
                    ),
                    buildLifecycle(context, {
                        routeSource: 'intent_control_plane',
                        route: 'direct_response',
                        intentSummary,
                        reason,
                        executionKind: 'none',
                        blockers: [message]
                    })
                );
            }
            const resultData = continuationRun.result.data
                && typeof continuationRun.result.data === 'object'
                ? continuationRun.result.data
                : {};
            return attachLifecycle(
                {
                    ...continuationRun.result,
                    data: {
                        ...resultData,
                        interactiveContinuationResolution: {
                            version: 'interactive-continuation-resolution/v0',
                            continuationId: resolution.continuation.id,
                            sourceMessageId: resolution.sourceMessageId,
                            cardId: resolution.submission.cardId,
                            status: continuationRun.settlementStatus || 'failed'
                        }
                    }
                },
                buildLifecycle(context, {
                    routeSource: 'intent_control_plane',
                    route: 'skill_execution',
                    skillId: resolution.skillId,
                    intentSummary: '继续执行用户刚确认的原挂起操作。',
                    reason: '操作账本中的一次性 continuation 已通过作用域和卡片绑定校验。',
                    executionKind: 'deterministic_skill',
                    observations: [{
                        source: 'interactive_continuation',
                        summary: `continuation=${resolution.continuation.id}; card=${resolution.submission.cardId}`
                    }]
                })
            );
        }

        // ── Route 3: structured internal resume ──
        // 确认结果不是新的用户自然语言。由来源消息、项目范围和原 Runtime 身份共同约束，
        // 直接续接自主循环，不再经过关键词分类、历史消息猜测或“确认话术”路由。
        if (context.internalResumeRequest) {
            const resolution = resolveAgentInternalResumeRequest({
                request: context.internalResumeRequest,
                conversationId: context.conversationId,
                projectId: context.projectContext?.projectId,
                projectPath: context.projectContext?.projectPath,
                conversationHistory: context.conversationHistory
            });
            if (resolution.status === 'rejected') {
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        {
                            success: false,
                            message: resolution.message,
                            error: resolution.code
                        },
                        deterministicBlockerReplyOrigin(`internal-resume:${resolution.code}`)
                    ),
                    buildLifecycle(context, {
                        routeSource: 'intent_control_plane',
                        route: 'direct_response',
                        intentSummary: '确认后的内部续跑请求未通过来源范围校验。',
                        reason: resolution.message,
                        executionKind: 'none',
                        blockers: [resolution.message]
                    })
                );
            }
            const request = resolution.request;
            const resumedContext: AgentContext = {
                ...context,
                userInput: request.sourceTask,
                internalResumeRequest: undefined
            };
            const autonomousDecision = buildAutonomousExecutionDecisionForEngine(
                '结构化确认结果已通过来源范围校验，直接从原任务等待点继续。'
            );
            callbacks?.onStep?.({
                kind: 'observation',
                title: '确认已收到，继续处理',
                detail: request.resolutionSummary,
                status: 'running',
                percent: 10,
                source: 'agent_runtime',
                audience: 'user',
                visibility: 'user_process'
            });
            return executeSkillWithLifecycle(resumedContext, {
                skillId: 'autonomous-agent',
                params: {
                    ...buildAutonomousSkillParams(resumedContext, autonomousDecision),
                    userTask: request.sourceTask,
                    internalResumeRequest: request,
                    ...(request.sourceRuntimeIdentity ? {
                        resumeSourceRunId: request.sourceRuntimeIdentity.runId,
                        resumeSourceSessionId: request.sourceRuntimeIdentity.sessionId,
                        resumeSourceGeneration: request.sourceRuntimeIdentity.generation
                    } : {})
                },
                callbacks,
                signal,
                routeSource: 'intent_control_plane',
                route: 'autonomous_agent',
                executionKind: 'autonomous_agent',
                intentSummary: '确认结果已落盘，从原任务等待点继续。',
                reason: '结构化内部续跑请求已通过对话、项目和来源消息校验。',
                callModel,
                intentControlPlane: autonomousDecision
            });
        }

        // ── Route 3: Public plan approval (structured owner confirmed → controlled run) ──
        const publicPlanApprovalRecord = buildAgentTaskPublicPlanApprovalRecord({
            userInput: context.userInput,
            conversationHistory: context.conversationHistory as unknown as Array<Record<string, unknown>>,
            sourceMessageId: context.agentTaskPublicPlanApproval?.sourceMessageId,
            requestId: context.agentTaskPublicPlanApproval?.requestId
        });
        if (publicPlanApprovalRecord.requested) {
            const lifecycle = buildLifecycle(context, {
                routeSource: 'lightweight_intent',
                route: 'direct_response',
                intentSummary: '用户确认上一轮公开设计计划，系统只生成待处理请求包。',
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

            const approvedRequestId = String(publicPlanApprovalRecord.requestId || '').trim();
            if (!approvedRequestId) {
                return attachLifecycle(
                    {
                        success: false,
                        message: '这条公开计划缺少独立请求身份，已经不能安全确认。请重新生成计划。',
                        error: 'public_plan_request_id_missing',
                        data: {
                            agentTaskPublicPlanApprovalRecord: publicPlanApprovalRecord
                        }
                    },
                    lifecycle
                );
            }

            const publicPlanExecutionRequest = buildAgentTaskPublicPlanExecutionRequest({
                agentTaskPlan: publicPlanApprovalRecord.agentTaskPlan,
                designDimensionSpec: context.designDimensionSpec,
                publicPlan: publicPlanApprovalRecord.agentTaskPublicPlan,
                runtimeAllowedWriteTools: context.agentTaskPublicPlanApproval?.allowedWriteTools
                    || publicPlanApprovalRecord.allowedWriteTools,
                userConfirmed: context.agentTaskPublicPlanApproval?.userConfirmed ?? publicPlanApprovalRecord.userConfirmed,
                enableControlledExecutionRequest: context.agentTaskPublicPlanApproval?.enableControlledExecutionRequest
                    ?? publicPlanApprovalRecord.enableControlledExecutionRequest,
                requestId: approvedRequestId,
                runtimeOperationRequests: context.agentTaskPublicPlanApproval?.runtimeOperationRequests
            });
            callbacks?.onStep?.({
                kind: 'observation',
                title: '准备按方案处理',
                detail: publicPlanApprovalRecord.agentTaskPublicPlan?.executionPlanSummary
                    || publicPlanApprovalRecord.agentTaskPublicPlan?.message
                    || '先按已确认的阶段目标处理画面，完成后再看真实结果。',
                status: 'success',
                percent: 32
            });
            const publicPlanControlledRun = await runAgentTaskPublicPlanControlledRunnerAsync({
                request: publicPlanExecutionRequest,
                executionTarget: context.agentTaskPublicPlanApproval?.executionTarget,
                allowPhotoshopWrites: context.agentTaskPublicPlanApproval?.allowPhotoshopWrites,
                liveExecutionScope: context.agentTaskPublicPlanApproval?.liveExecutionScope,
                explicitProjectWriteApproval: context.agentTaskPublicPlanApproval?.explicitProjectWriteApproval,
                adapter: context.agentTaskPublicPlanApproval?.adapter
            });

            emitControlledRunVisibleReview(callbacks, publicPlanControlledRun);

            // 确认范围内处理失败时，回到 Agent ReAct + Reflexion，而不是直接返回"缺少关键信息"。
            // 确认范围内处理流程是确定性 for 循环，失败即停（controlled-runner.ts:1212），
            // 没有 ReAct 的观察/换路能力，也没有 Reflexion 的重跑能力。
            // 回退后 Agent 在 ReAct 循环中观察失败、决定换路；Agent 失败后走 Reflexion 回路。
            if (shouldRecoverFromPublicPlanControlledRunFailure(publicPlanControlledRun)) {
                const recoveryTask = buildControlledRunFailureRecoveryTask(
                    publicPlanApprovalRecord,
                    publicPlanControlledRun,
                    {
                        liveExecutionScope: context.agentTaskPublicPlanApproval?.liveExecutionScope,
                        explicitProjectWriteApproval: context.agentTaskPublicPlanApproval?.explicitProjectWriteApproval
                    }
                );
                callbacks?.onStep?.({
                    kind: 'observation',
                    title: '确认范围内处理未完成，转入 Agent 自主恢复',
                    detail: `已确认计划的处理失败（${publicPlanControlledRun.blockers.join('；')}），转入 Agent ReAct 循环观察失败并换路重试。`,
                    status: 'running',
                    percent: 35,
                    source: 'agent_runtime',
                    audience: 'user',
                    visibility: 'user_process'
                });
                const autonomousDecision = buildAutonomousExecutionDecisionForEngine(
                    '已确认计划的处理失败，转入 Agent 自主恢复；Agent 应在失败的操作上换路重试，不要重新规划整个任务。'
                );
                return executeSkillWithLifecycle(context, {
                    skillId: 'autonomous-agent',
                    params: {
                        ...buildAutonomousSkillParams(context, autonomousDecision),
                        userTask: recoveryTask,
                        runtimeAllowedWriteTools: [...publicPlanApprovalRecord.allowedWriteTools]
                    },
                    callbacks,
                    signal,
                    routeSource: 'intent_control_plane',
                    route: 'autonomous_agent',
                    executionKind: 'autonomous_agent',
                    intentSummary: '确认范围内处理失败后转入 Agent 自主恢复。',
                    reason: '已确认计划的处理在写入操作上失败，转入 Agent ReAct 循环观察失败并换路重试；Agent 失败后走 Reflexion 回路。',
                    callModel,
                    intentControlPlane: autonomousDecision
                });
            }

            return attachLifecycle(
                buildPublicPlanControlledRunResult({
                    approvalRecord: publicPlanApprovalRecord,
                    executionRequest: publicPlanExecutionRequest,
                    controlledRun: publicPlanControlledRun
                }),
                buildLifecycle(context, {
                    routeSource: 'intent_control_plane',
                    route: 'skill_execution',
                    skillId: 'autonomous-agent',
                    intentSummary: '按已确认的设计方案处理。',
                    reason: '用户确认设计方案后，已按确认范围处理并复核画面。',
                    executionKind: 'deterministic_skill',
                    blockers: publicPlanControlledRun.blockers,
                    warnings: publicPlanControlledRun.warnings
                })
            );
        }

        // 裸“继续/开始/可以”只进入统一的 resumable-task 对话边界。它不能从自然语言历史
        // 复活一个新的 Photoshop 写任务；卡片与公开计划分别由各自的结构化 continuation owner 接回。
        const intentClassificationInput = context.userInput;

        // ── Route 5: No model available → runWithoutModel ──
        if (!callModel) {
            const operatingPhotoshopConnected = resolveOperatingPhotoshopConnection(context.operatingContextSnapshot)
                // 快照「说不出」(freshness !== 'current') 与「说没连」是两回事，
                // 前者必须回落到实时连接状态，否则会被下游折成 false 产出未连接硬阻断。
                ?? context.isPluginConnected;
            const operatingPhotoshopHasDocument = resolveOperatingPhotoshopDocumentPresence(context.operatingContextSnapshot)
                ?? context.photoshopContext?.hasDocument;
            const rawLegacyIntentControlPlane = buildAgentIntentControlPlaneDecision({
                userInput: intentClassificationInput,
                hasImageInput: hasContextImageInput(context),
                hasDocument: operatingPhotoshopHasDocument,
                photoshopConnected: operatingPhotoshopConnected
            });
            const legacyIntentControlPlane = applyExplicitAgentCapabilityCeiling(
                rawLegacyIntentControlPlane,
                extractExplicitUserCapabilityConstraint(intentClassificationInput)
            );
            return this.runWithoutModel(context, options, legacyIntentControlPlane);
        }

        callbacks?.onStep?.({
            kind: 'model_request',
            title: '正在理解并处理任务',
            detail: '正在理解需求，决定先看什么、再做什么',
            status: 'running',
            percent: 10,
            source: 'agent_runtime',
            audience: 'user',
            visibility: 'user_process'
        });

        // 单通用 Agent + 同一能力目录不需要先付出一次独立 Router 模型调用。前置 Router
        // 既增加延迟和成本，也会把一次有偏猜测带进主循环。开放语义直接由主 Agent 判断；
        // Harness 这里只提取 deny-only 用户边界，不替 Agent 推断用户想做什么。
        const capabilityConstraint = extractExplicitUserCapabilityConstraint(context.userInput);
        const engineDecision = buildAutonomousExecutionDecisionForEngine(
            '普通自然语言默认由通用 Agent 承接；是否调用能力由主循环结合上下文和真实状态决定。'
        );
        let intentControlPlane = applyExplicitAgentCapabilityCeiling(
            {
                ...engineDecision,
                matchedSignals: Array.from(new Set([
                    ...engineDecision.matchedSignals,
                    'agent_first_natural_language',
                    'pre_router_bypassed'
                ]))
            },
            capabilityConstraint
        );

        // 结构化 continuation 已在上方由各 owner 接回。走到这里的裸确认没有 taskRunId、
        // interactionId 与 revision，不能恢复历史写权限；其他自然语言仍交给主 Agent，
        // 不能再让启发式分类器成为第二套权限系统。
        const lightweightIntent = detectLightweightIntent(
            intentClassificationInput,
            intentControlPlane
        );
        const businessSkillRoutingOptions: FindSkillRoutingIntentOptions = {
            includeVisibilities: ['user-facing'],
            includeRouteClasses: ['business-workflow'],
            modelDirectExecution: 'forbidden'
        };
        const skillRoutingRecommendation = buildSkillRoutingRecommendation(
            context.userInput,
            businessSkillRoutingOptions
        );
        const unboundAcknowledgement = (
            lightweightIntent === 'ack'
            || lightweightIntent === 'continuation'
        )
            || isPublicPlanConfirmationInput(intentClassificationInput);
        // GATE-SIMPLIFY-007：同会话分支存在可续接的未完成运行档案时，裸「继续」是明确的
        // 续做意图——保留写权限并接入 Run Record 续接（执行点约束不变）；无档案（新会话/
        // 已完成/跨分支/过期/查询失败）一律维持旧降级，不恢复历史写权限。
        const resumableRecordAvailable = unboundAcknowledgement
            ? await resolveBareContinuationResumableRecord({
                conversationId: context.conversationId,
                conversationBranchId: context.conversationBranchId,
                projectPath: context.projectContext?.projectPath
            })
            : false;
        const bareContinuationDecision = resolveBareContinuationResumeDecision({
            unboundAcknowledgement,
            executionAuthorization: intentControlPlane.executionAuthorization,
            resumableRecordAvailable
        });
        if (bareContinuationDecision.demote) {
            intentControlPlane = {
                ...intentControlPlane,
                executionAuthorization: 'candidate_only',
                reason: bareContinuationDecision.reason,
                matchedSignals: Array.from(new Set([
                    ...intentControlPlane.matchedSignals,
                    'unbound_acknowledgement_or_continuation_no_write'
                ]))
            };
        } else if (bareContinuationDecision.matchedSignal) {
            intentControlPlane = {
                ...intentControlPlane,
                reason: bareContinuationDecision.reason,
                matchedSignals: Array.from(new Set([
                    ...intentControlPlane.matchedSignals,
                    bareContinuationDecision.matchedSignal
                ]))
            };
        }

        // “由谁做”与“这轮必须真实推进”是两个独立身份：Manifest recommendation 只
        // 选择唯一 Owner；TaskPlan 的进展义务由品类无关的语用关系签发。这样复杂 brief、
        // 多交付物或来源→目标请求即使没有静态 Owner，也不能用一段文字假装已完成；
        // 能力问答、纯检查和条件式修复则不会被 Harness 强迫生产。
        const semanticIntentDecision = applyExplicitAgentCapabilityCeiling(
            buildAgentIntentControlPlaneDecision({
                userInput: intentClassificationInput,
                hasImageInput: hasContextImageInput(context),
                hasDocument: resolveOperatingPhotoshopDocumentPresence(
                    context.operatingContextSnapshot
                ) ?? context.photoshopContext?.hasDocument,
                photoshopConnected: resolveOperatingPhotoshopConnection(
                    context.operatingContextSnapshot
                ) ?? context.isPluginConnected
            }),
            capabilityConstraint
        );
        const taskProgressIdentity = resolveAgentTaskProgressIdentity({
            userInput: context.userInput,
            runtimeDecision: intentControlPlane,
            semanticDecision: semanticIntentDecision,
            capabilityConstraint
        });
        // 只有用户在输入框显式选择，才能在模型运行前形成 Skill 身份。文本匹配仅保留
        // advisory recommendation；模型理解任务后可通过 declareDesignIntent 自己绑定 Profile。
        const runtimeSelectedSkillHandoff = taskProgressIdentity.progressObligation === 'delivery'
            ? buildRuntimeSelectedSkillHandoffFromUserSelection({
                userSelectedSkillId: context.userSelectedSkillId,
                intentControlPlane,
                skillBridgePolicy: capabilityConstraint.skillBridgePolicy,
                deniedToolDomains: capabilityConstraint.deniedToolDomains,
                toolScopeCeiling: capabilityConstraint.toolScopeCeiling
            })
            : undefined;
        const requiresProductionProgress = taskProgressIdentity.requiresTaskProgress;

        const hasWriteEnvelope = intentControlPlane.toolScope === 'write_photoshop'
            && intentControlPlane.executionAuthorization === 'confirmed_tool_required';
        callbacks?.onStep?.({
            kind: 'model_request',
            title: hasWriteEnvelope ? '正在处理任务' : '正在理解任务',
            detail: hasWriteEnvelope
                ? '正在动手制作，每一步改动都会检查结果'
                : '正在了解画面和素材，这一步只看不改',
            status: 'running',
            percent: 20,
            source: 'agent_runtime',
            audience: 'user',
            visibility: 'user_process'
        });
        callbacks?.onProgress?.(hasWriteEnvelope ? 'Agent 正在处理任务' : 'Agent 正在理解任务', 20);

        return executeSkillWithLifecycle(context, {
            skillId: 'autonomous-agent',
            params: buildAutonomousSkillParams(
                context,
                intentControlPlane,
                runtimeSelectedSkillHandoff,
                capabilityConstraint
            ),
            callbacks,
            signal,
            routeSource: 'intent_control_plane',
            route: 'autonomous_agent',
            executionKind: 'autonomous_agent',
            intentSummary: '由通用 Agent 理解并处理当前请求。',
            reason: '普通自然语言直接进入通用 Agent；能力选择和是否行动由主循环与执行点策略共同决定。',
            callModel,
            intentControlPlane,
            requiresTaskProgress: requiresProductionProgress,
            taskProgressObligation: taskProgressIdentity.progressObligation
        });
    }

    /**
     * 无可用模型时的显式降级路径：
     * 寒暄类输入用本地回复；命中确定性路由的任务按规则执行（明确标注降级）；
     * 其余如实告知模型不可用，不做关键词猜测执行。
     */
    private async runWithoutModel(
        context: AgentContext,
        options: ProcessOptions,
        intentControlPlane: AgentIntentControlPlaneDecision
    ): Promise<AgentResult> {
        const { callbacks, signal } = options;
        const clarificationFollowup = detectClarificationFollowupContext(context);
        const lightweightIntent = detectLightweightIntent(context.userInput, intentControlPlane);
        const shouldUseConversationalRoute = shouldEnterConversationalRoute({
            requestKind: intentControlPlane.requestKind,
            executionAuthorization: intentControlPlane.executionAuthorization,
            allowsAutonomousExecution: intentControlPlane.allowsAutonomousExecution,
            intentRequestsConversationalPath: intentControlPlane.shouldUseConversationalPath,
            lightweightIntentIsConversational: isModelFirstConversationalIntent(lightweightIntent)
        });
        if (clarificationFollowup || shouldUseConversationalRoute) {
            const route: AgentRequestRoute = intentControlPlane.requiresClarificationBeforeTools
                ? 'clarification_needed'
                : 'direct_response';
            return attachLifecycle(
                buildConversationalUnavailableStatusResult(lightweightIntent || 'chat', context, undefined),
                buildLifecycle(context, {
                    routeSource: intentControlPlane.requestKind === 'plan_only'
                        ? 'intent_control_plane'
                        : 'lightweight_intent',
                    route,
                    intentSummary: clarificationFollowup
                        ? '用户在追问上一轮澄清要求，但当前没有可用模型。'
                        : intentControlPlane.userVisibleSummary,
                    reason: '当前没有可用模型，不能编造本地对话或固定能力菜单。',
                    executionKind: 'none'
                }),
                intentControlPlane
            );
        }

        if (isModelFirstConversationalIntent(lightweightIntent)) {
            const localReply = buildLocalConversationalReply(lightweightIntent, context);
            if (localReply) {
                return attachLifecycle(
                    await buildConversationalAgentResult(lightweightIntent, context, localReply, {
                        assistantReplyOrigin: uiStatusReplyOrigin(`conversational:${lightweightIntent}:local-status`)
                    }),
                    buildLifecycle(context, {
                        routeSource: 'lightweight_intent',
                        route: 'direct_response',
                        intentSummary: '无可用模型，使用本地对话回复。',
                        reason: `降级模式：轻量意图识别为 ${lightweightIntent}，使用本地回复。`
                    })
                );
            }
        }

        if (intentControlPlane.allowsAutonomousExecution) {
            return attachLifecycle(
                buildConversationalUnavailableStatusResult('chat', context, undefined),
                buildLifecycle(context, {
                    routeSource: 'intent_control_plane',
                    route: 'autonomous_agent',
                    intentSummary: intentControlPlane.userVisibleSummary,
                    reason: '当前没有可用模型，不能编造本地设计计划或固定澄清话术。',
                    executionKind: 'none'
                }),
                intentControlPlane
            );
        }

        const route = buildRetryDeterministicRoute(context)
            || fastDeterministicRoute(context.userInput, {
                hasAttachedImage: hasContextImageInput(context),
                intentControlPlane
            });

        if (route && canExecuteSkillUnderIntentAuthorization(
            route.skillId,
            route.skillParams,
            intentControlPlane
        )) {
            const unavailable = buildSkillUnavailableResult(route.skillId, context.userInput);
            if (unavailable) {
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        unavailable,
                        deterministicBlockerReplyOrigin(`skill:${route.skillId}:unavailable`)
                    ),
                    buildLifecycle(context, {
                        routeSource: 'deterministic_route',
                        route: 'skill_execution',
                        skillId: route.skillId,
                        intentSummary: route.thinking,
                        reason: '降级模式命中确定性路由，但能力不可用。'
                    })
                );
            }
            callbacks?.onStep?.({
                kind: 'tool_planned',
                title: `降级执行：${route.skillId}`,
                detail: '当前没有可用模型，按确定性规则降级执行（规则模式，未经过模型决策）。',
                status: 'success',
                percent: 24
            });
            callbacks?.onProgress?.('按规则执行', 24);
            return executeSkillWithDesignPreflight(context, {
                skillId: route.skillId,
                params: route.skillParams,
                callbacks,
                signal,
                routeSource: 'deterministic_route',
                intentSummary: route.thinking,
                reason: '无可用模型，按确定性规则降级执行。'
            });
        }

        return attachLifecycle(
            buildConversationalUnavailableStatusResult('chat', context, undefined),
            buildLifecycle(context, {
                routeSource: 'system',
                route: 'clarification_needed',
                intentSummary: '无可用模型，且未命中确定性规则。',
                reason: '降级模式下不做关键词猜测执行，如实告知模型不可用。',
                executionKind: 'none'
            })
        );
    }

    debugDecisionFromText(userInput: string) {
        return debugInferDecisionFromText(userInput);
    }
}

function buildInteractiveContinuationSettlementFailureMessage(
    mutationState: InteractiveContinuationMutationState,
    settlementMessage: string,
    businessResultSucceeded: boolean
): string {
    if (mutationState === 'none') {
        return [
            businessResultSucceeded
                ? '业务处理已经返回成功结果，并确认本轮没有产生 Photoshop 修改，但持久化状态没有完成结算。'
                : '业务处理已经返回失败结果，并确认本轮没有产生 Photoshop 修改，但持久化状态没有完成结算。',
            settlementMessage,
            '请不要重复点击这张卡；可以根据原提示重新发起任务。'
        ].filter(Boolean).join('\n');
    }
    return [
        mutationState === 'observed'
            ? '确认操作失败前已经观察到画面或文件修改，但持久化状态没有完成结算。'
            : '确认操作已经返回结果，但缺少可靠的修改统计，且持久化状态没有完成结算。',
        settlementMessage,
        '请先检查 Photoshop 当前画面，不要重复点击这张卡。'
    ].filter(Boolean).join('\n');
}

export const designAgentEngine = new DesignAgentEngine();

export async function processWithUnifiedAgent(
    context: AgentContext,
    options: ProcessOptions
): Promise<AgentResult> {
    return designAgentEngine.run(context, options);
}

export { debugInferDecisionFromText };
