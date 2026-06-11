import {
    buildAgentPerformancePolicy,
    type AgentPerformancePolicy
} from './agent-performance-policy';

export type AgentRequestLifecycleVersion = 'agent-request-lifecycle/v0';

export type AgentRequestRouteSource =
    | 'system'
    | 'intent_control_plane'
    | 'lightweight_intent'
    | 'deterministic_route'
    | 'model_router'
    | 'fallback';

export type AgentRequestRoute =
    | 'cancelled'
    | 'direct_response'
    | 'clarification_needed'
    | 'skill_execution'
    | 'autonomous_agent';

export type AgentRequestExecutionKind =
    | 'none'
    | 'deterministic_skill'
    | 'autonomous_agent';

export interface AgentRequestContextInput {
    isPluginConnected?: boolean;
    hasAttachedImage?: boolean;
    attachedImageData?: string;
    attachedImages?: unknown[];
    photoshopContext?: {
        hasDocument?: boolean;
        documentName?: string;
        activeLayerName?: string;
        layerCount?: number;
    };
    projectContext?: {
        projectPath?: string;
        projectImageCount?: number;
        visualSamplingCandidateCount?: number;
        selectedProjectImagePath?: string;
        contextSnapshot?: unknown;
        contextSnapshotSource?: string;
        contextSnapshotWarnings?: string[];
        contextSnapshotLimitations?: string[];
    };
}

export interface AgentRequestContextReadiness {
    photoshopConnected: boolean;
    hasDocument: boolean;
    documentName?: string;
    activeLayerName?: string;
    layerCount?: number;
    hasProject: boolean;
    projectPath?: string;
    projectImageCount?: number;
    selectedProjectImagePath?: string;
    hasContextSnapshot: boolean;
    contextSnapshotSource?: string;
    hasImageInput: boolean;
}

export interface AgentRequestDecisionEvidence {
    source: AgentRequestRouteSource;
    route: AgentRequestRoute;
    skillId?: string;
    mode?: string;
    intentSummary?: string;
    reason: string;
}

export interface AgentRequestExecutionEvidence {
    kind: AgentRequestExecutionKind;
    expectedExecutor?: string;
    requiresPhotoshop: boolean;
    canStart: boolean;
}

export type AgentRequestResourceDecisionPath =
    | 'no-tools'
    | 'metadata-only'
    | 'bounded-vision'
    | 'tool-execution'
    | 'blocked';

export interface AgentRequestResourceDecision {
    decisionVersion: 'agent-request-resource-decision/v0';
    path: AgentRequestResourceDecisionPath;
    reason: string;
    maxModelCalls: number;
    maxToolCalls: number;
    maxVisionCandidates: number;
    maxVisualAnalyses: number;
    softTimeBudgetMs: number;
    requiresContextSnapshot: boolean;
    hasContextSnapshot: boolean;
    evidence: AgentRequestLifecycleEvidenceRef[];
}

export interface AgentRequestLifecycleEvidenceRef {
    source: string;
    summary: string;
}

export interface AgentRequestLifecycleEvidence {
    version: AgentRequestLifecycleVersion;
    request: {
        rawText: string;
        normalizedText: string;
    };
    context: AgentRequestContextReadiness;
    decision: AgentRequestDecisionEvidence;
    execution: AgentRequestExecutionEvidence;
    performancePolicy: AgentPerformancePolicy;
    resourceDecision: AgentRequestResourceDecision;
    blockers: string[];
    warnings: string[];
    evidence: AgentRequestLifecycleEvidenceRef[];
}

export interface BuildAgentRequestLifecycleInput {
    userInput: unknown;
    context?: AgentRequestContextInput;
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
    evidence?: AgentRequestLifecycleEvidenceRef[];
}

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function hasImageInput(context?: AgentRequestContextInput): boolean {
    if (!context) return false;
    if (context.hasAttachedImage) return true;
    if (context.attachedImageData) return true;
    return Array.isArray(context.attachedImages) && context.attachedImages.length > 0;
}

function buildContextReadiness(context?: AgentRequestContextInput): AgentRequestContextReadiness {
    const photoshop = context?.photoshopContext;
    const project = context?.projectContext;

    return {
        photoshopConnected: context?.isPluginConnected === true,
        hasDocument: photoshop?.hasDocument === true,
        documentName: normalizeText(photoshop?.documentName) || undefined,
        activeLayerName: normalizeText(photoshop?.activeLayerName) || undefined,
        layerCount: Number.isFinite(Number(photoshop?.layerCount)) ? Number(photoshop?.layerCount) : undefined,
        hasProject: Boolean(project?.projectPath),
        projectPath: normalizeText(project?.projectPath) || undefined,
        projectImageCount: Number.isFinite(Number(project?.projectImageCount)) ? Number(project?.projectImageCount) : undefined,
        selectedProjectImagePath: normalizeText(project?.selectedProjectImagePath) || undefined,
        hasContextSnapshot: Boolean(project?.contextSnapshot),
        contextSnapshotSource: normalizeText(project?.contextSnapshotSource) || undefined,
        hasImageInput: hasImageInput(context)
    };
}

function pickObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function pickArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function countVisualSamplingCandidates(context?: AgentRequestContextInput): number {
    const project = pickObject(context?.projectContext);
    const explicitCount = Number(project.visualSamplingCandidateCount);
    if (Number.isFinite(explicitCount) && explicitCount >= 0) return explicitCount;

    const visualSamplingPlan = pickObject(project.visualSamplingPlan);
    const selectedCandidates = pickArray(visualSamplingPlan.selectedCandidates);
    if (selectedCandidates.length > 0) return selectedCandidates.length;

    const contextSnapshot = pickObject(project.contextSnapshot);
    const snapshotVisualSamplingPlan = pickObject(contextSnapshot.visualSamplingPlan);
    const snapshotSelectedCandidates = pickArray(snapshotVisualSamplingPlan.selectedCandidates);
    if (snapshotSelectedCandidates.length > 0) return snapshotSelectedCandidates.length;

    const assetIndex = pickObject(project.assetIndex || contextSnapshot.assetIndex);
    const visionCandidates = pickArray(assetIndex.visionCandidates);
    return visionCandidates.length;
}

function defaultExecutionKind(route: AgentRequestRoute): AgentRequestExecutionKind {
    if (route === 'skill_execution') return 'deterministic_skill';
    if (route === 'autonomous_agent') return 'autonomous_agent';
    return 'none';
}

function requiresPhotoshop(route: AgentRequestRoute): boolean {
    return route === 'skill_execution' || route === 'autonomous_agent';
}

function canStartExecution(
    route: AgentRequestRoute,
    context: AgentRequestContextReadiness,
    skillId?: string
): boolean {
    if (!requiresPhotoshop(route)) return true;
    if (!context.photoshopConnected) return false;
    if (skillId === 'document-management') return true;
    if (skillId === 'main-image-template-authoring') return true;
    if (skillId === 'detail-page-template-authoring') return true;
    return context.hasDocument;
}

function collectWarnings(
    input: BuildAgentRequestLifecycleInput,
    context: AgentRequestContextReadiness
): string[] {
    const warnings = Array.isArray(input.warnings) ? input.warnings.filter(Boolean) : [];
    const projectWarnings = input.context?.projectContext?.contextSnapshotWarnings || [];
    const projectLimitations = input.context?.projectContext?.contextSnapshotLimitations || [];

    if (requiresPhotoshop(input.route) && !context.photoshopConnected) {
        warnings.push('Photoshop 未连接，执行型请求可能无法开始。');
    }
    if (requiresPhotoshop(input.route) && !context.hasDocument && input.skillId !== 'document-management') {
        warnings.push('当前没有打开文档，非文档创建/管理类任务需要先确认上下文。');
    }

    return [
        ...warnings,
        ...projectWarnings.filter(Boolean),
        ...projectLimitations.filter(Boolean)
    ];
}

function buildLifecyclePerformancePolicy(
    input: BuildAgentRequestLifecycleInput,
    context: AgentRequestContextReadiness
): AgentPerformancePolicy {
    return buildAgentPerformancePolicy({
        userText: normalizeText(input.userInput),
        skillId: input.skillId,
        mode: input.mode,
        skillParams: input.skillParams,
        hasAttachedImage: context.hasImageInput,
        requiresPhotoshop: requiresPhotoshop(input.route),
        projectImageCount: context.projectImageCount,
        visualSamplingCandidateCount: countVisualSamplingCandidates(input.context)
    });
}

function buildResourceDecision(input: {
    route: AgentRequestRoute;
    context: AgentRequestContextReadiness;
    execution: AgentRequestExecutionEvidence;
    performancePolicy: AgentPerformancePolicy;
    blockers: string[];
}): AgentRequestResourceDecision {
    const policy = input.performancePolicy;
    const budget = policy.budget;
    let path: AgentRequestResourceDecisionPath = 'tool-execution';
    let reason = '根据请求路由和性能策略允许进入受控工具执行。';

    if (input.blockers.length > 0 || !input.execution.canStart) {
        path = 'blocked';
        reason = '执行前上下文或控制面阻断，不能进入工具执行。';
    } else if (!requiresPhotoshop(input.route) || input.execution.kind === 'none') {
        path = 'no-tools';
        reason = '该请求不需要 Photoshop 工具执行。';
    } else if (policy.costProfile.imageProcessingClass === 'metadata-only'
        && budget.maxVisionCandidates === 0
        && budget.maxVisualAnalyses === 0) {
        path = 'metadata-only';
        reason = '性能策略判定只需要项目元数据或 Photoshop 轻量只读证据，不允许视觉分析。';
    } else if (policy.controls.allowVisionModel && budget.maxVisionCandidates > 0) {
        path = 'bounded-vision';
        reason = '性能策略允许有界视觉候选，禁止全量项目视觉分析和全分辨率读图。';
    }

    return {
        decisionVersion: 'agent-request-resource-decision/v0',
        path,
        reason,
        maxModelCalls: budget.maxModelCalls,
        maxToolCalls: budget.maxToolCalls,
        maxVisionCandidates: budget.maxVisionCandidates,
        maxVisualAnalyses: budget.maxVisualAnalyses,
        softTimeBudgetMs: budget.softTimeBudgetMs,
        requiresContextSnapshot: policy.controls.requireContextSnapshotBeforeExecution,
        hasContextSnapshot: input.context.hasContextSnapshot,
        evidence: [{
            source: 'agent-performance-policy',
            summary: `taskClass=${policy.taskClass}; imageProcessing=${policy.costProfile.imageProcessingClass}; path=${path}`
        }]
    };
}

export function buildAgentRequestLifecycle(
    input: BuildAgentRequestLifecycleInput
): AgentRequestLifecycleEvidence {
    const rawText = normalizeText(input.userInput);
    const context = buildContextReadiness(input.context);
    const executionKind = input.executionKind || defaultExecutionKind(input.route);
    const requiresPs = requiresPhotoshop(input.route);
    const canStart = canStartExecution(input.route, context, input.skillId);
    const blockers = Array.isArray(input.blockers) ? input.blockers.filter(Boolean) : [];

    if (requiresPs && !canStart) {
        blockers.push('执行前上下文不足，需要补齐 Photoshop 连接或当前文档证据。');
    }
    const execution: AgentRequestExecutionEvidence = {
        kind: executionKind,
        expectedExecutor: normalizeText(input.skillId) || undefined,
        requiresPhotoshop: requiresPs,
        canStart
    };
    const performancePolicy = buildLifecyclePerformancePolicy(input, context);
    const resourceDecision = buildResourceDecision({
        route: input.route,
        context,
        execution,
        performancePolicy,
        blockers
    });

    return {
        version: 'agent-request-lifecycle/v0',
        request: {
            rawText,
            normalizedText: rawText.toLowerCase()
        },
        context,
        decision: {
            source: input.routeSource,
            route: input.route,
            skillId: normalizeText(input.skillId) || undefined,
            mode: normalizeText(input.mode) || undefined,
            intentSummary: normalizeText(input.intentSummary) || undefined,
            reason: normalizeText(input.reason) || '记录请求生命周期路由证据。'
        },
        execution,
        performancePolicy,
        resourceDecision,
        blockers,
        warnings: collectWarnings(input, context),
        evidence: [
            ...(Array.isArray(input.evidence) ? input.evidence : []),
            {
                source: 'design-agent-engine',
                summary: 'DesignAgentEngine 生成请求生命周期只读证据，不改变业务执行行为。'
            }
        ]
    };
}

export function withAgentRequestLifecycle<T extends { data?: unknown }>(
    result: T,
    lifecycle: AgentRequestLifecycleEvidence
): T {
    const currentData = result.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : {};
    return {
        ...result,
        data: {
            ...currentData,
            agentRequestLifecycle: lifecycle
        }
    };
}
