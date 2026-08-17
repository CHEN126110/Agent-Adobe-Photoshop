import type { RuntimeDesignWorkMode } from './agent-runtime-v5/contracts';
import {
    capabilityBlocksExecution,
    resolveDeclaredCapabilityVerdict
} from './model-capability-verdict';
import { getSkillById } from './skills/skill-declarations';

export type AgentRequestLifecycleVersion = 'agent-request-lifecycle/v0';

export type AgentRequestRouteSource =
    | 'system'
    | 'intent_control_plane'
    | 'lightweight_intent'
    | 'deterministic_route'
    | 'local_route'
    | 'model_router';

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
        selectedProjectImagePath?: string;
        contextSnapshot?: unknown;
        contextSnapshotSource?: string;
        contextSnapshotWarnings?: string[];
        contextSnapshotLimitations?: string[];
    };
}

export interface AgentRequestContextReadiness {
    /** undefined 表示上游没有提供新鲜事实；unknown 不能折成否定。 */
    photoshopConnected?: boolean;
    /** undefined 表示上游没有提供新鲜事实；真实 Tool 调用会给出最终结果。 */
    hasDocument?: boolean;
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

export interface AgentRequestDecision {
    source: AgentRequestRouteSource;
    route: AgentRequestRoute;
    skillId?: string;
    /** autonomous-agent 是执行器身份；该字段保留 R0 已选的业务 Skill 身份。 */
    selectedSkillId?: string;
    /** 只接受上游结构化声明，不从用户文本推断。 */
    taskType?: string;
    /** 只接受上游结构化声明，不从用户文本推断。 */
    workMode?: RuntimeDesignWorkMode;
    /** 仅在存在结构化 taskType / workMode 时保留对应业务参数。 */
    skillParams?: Record<string, unknown>;
    mode?: string;
    intentSummary?: string;
    reason: string;
}

export interface AgentRequestExecutionState {
    kind: AgentRequestExecutionKind;
    expectedExecutor?: string;
    requiresPhotoshop: boolean;
    canStart: boolean;
}

export interface AgentRequestLifecycleObservationRef {
    source: string;
    summary: string;
}

export interface AgentRequestLifecycleRecord {
    version: AgentRequestLifecycleVersion;
    request: {
        rawText: string;
        normalizedText: string;
    };
    context: AgentRequestContextReadiness;
    decision: AgentRequestDecision;
    execution: AgentRequestExecutionState;
    blockers: string[];
    warnings: string[];
    observations: AgentRequestLifecycleObservationRef[];
}

export interface BuildAgentRequestLifecycleInput {
    userInput: unknown;
    context?: AgentRequestContextInput;
    routeSource: AgentRequestRouteSource;
    route: AgentRequestRoute;
    skillId?: string;
    selectedSkillId?: string;
    taskType?: string;
    workMode?: RuntimeDesignWorkMode;
    mode?: string;
    skillParams?: Record<string, unknown>;
    intentSummary?: string;
    reason?: string;
    executionKind?: AgentRequestExecutionKind;
    blockers?: string[];
    warnings?: string[];
    observations?: AgentRequestLifecycleObservationRef[];
}

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function normalizeRuntimeDesignWorkMode(value: unknown): RuntimeDesignWorkMode | undefined {
    const candidate = normalizeText(value) as RuntimeDesignWorkMode;
    return [
        'create_new',
        'redesign',
        'template_fill',
        'edit_existing',
        'analyze_only',
        'export_only'
    ].includes(candidate) ? candidate : undefined;
}

interface AgentRequestStructuredDecisionIdentity {
    selectedSkillId?: string;
    taskType?: string;
    workMode?: RuntimeDesignWorkMode;
    skillParams?: Record<string, unknown>;
}

function resolveStructuredDecisionIdentity(
    input: BuildAgentRequestLifecycleInput
): AgentRequestStructuredDecisionIdentity {
    const wrapperParams = asRecord(input.skillParams);
    const nestedSkillParams = asRecord(wrapperParams?.skillParams);
    const businessSkillParams = nestedSkillParams || wrapperParams;
    const runtimeSelectedSkillHandoff = asRecord(wrapperParams?.runtimeSelectedSkillHandoff);
    const selectedSkillId = normalizeText(input.selectedSkillId)
        || normalizeText(wrapperParams?.declaredSkillId)
        || normalizeText(runtimeSelectedSkillHandoff?.skillId)
        || undefined;
    const taskType = normalizeText(input.taskType)
        || normalizeText(wrapperParams?.declaredTaskType)
        || normalizeText(businessSkillParams?.taskType)
        || undefined;
    const workMode = normalizeRuntimeDesignWorkMode(
        input.workMode
        || wrapperParams?.declaredWorkMode
        || businessSkillParams?.workMode
    );
    const hasStructuredPlanningParams = Boolean(taskType || workMode);

    return {
        ...(selectedSkillId ? { selectedSkillId } : {}),
        ...(taskType ? { taskType } : {}),
        ...(workMode ? { workMode } : {}),
        ...(hasStructuredPlanningParams && businessSkillParams
            ? { skillParams: { ...businessSkillParams } }
            : {})
    };
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
        photoshopConnected: typeof context?.isPluginConnected === 'boolean'
            ? context.isPluginConnected
            : undefined,
        hasDocument: typeof photoshop?.hasDocument === 'boolean'
            ? photoshop.hasDocument
            : undefined,
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

function defaultExecutionKind(route: AgentRequestRoute): AgentRequestExecutionKind {
    if (route === 'skill_execution') return 'deterministic_skill';
    if (route === 'autonomous_agent') return 'autonomous_agent';
    return 'none';
}

function normalizeSourceType(value: unknown): string {
    return normalizeText(value).toLowerCase().replace(/-/g, '_');
}

function requiresPhotoshopForSkill(
    skillId: string | undefined,
    skillParams?: Record<string, unknown>
): boolean {
    const requirements = skillId ? getSkillById(skillId)?.runtimeRequirements : undefined;
    if (requirements?.photoshop === 'not_required') return false;
    if (requirements?.photoshop === 'source_dependent') {
        const sourceType = normalizeSourceType(skillParams?.sourceType);
        const photoshopFreeSourceTypes = new Set(
            (requirements.photoshopFreeSourceTypes || []).map(normalizeSourceType)
        );
        return !sourceType || !photoshopFreeSourceTypes.has(sourceType);
    }
    return true;
}

function isStructuredAutonomousPhotoshopRequest(
    skillParams: Record<string, unknown> | undefined,
    structuredDecision?: AgentRequestStructuredDecisionIdentity
): boolean {
    const wrapperParams = asRecord(skillParams);
    const internalResumeRequest = asRecord(wrapperParams?.internalResumeRequest);
    if (normalizeText(internalResumeRequest?.version) === 'agent-internal-resume/v0') return true;

    const runtimeAllowedWriteTools = Array.isArray(wrapperParams?.runtimeAllowedWriteTools)
        ? wrapperParams.runtimeAllowedWriteTools
            .map(normalizeText)
            .filter(Boolean)
        : [];
    if (runtimeAllowedWriteTools.length > 0) return true;

    if (structuredDecision?.selectedSkillId) {
        return requiresPhotoshopForSkill(
            structuredDecision.selectedSkillId,
            structuredDecision.skillParams || wrapperParams
        );
    }
    if (structuredDecision?.workMode === 'analyze_only') return false;
    return Boolean(structuredDecision?.taskType || structuredDecision?.workMode);
}

function requiresPhotoshop(
    route: AgentRequestRoute,
    skillId?: string,
    skillParams?: Record<string, unknown>,
    structuredDecision?: AgentRequestStructuredDecisionIdentity
): boolean {
    // autonomous_agent 是理解与决策载体，不等于 Photoshop 执行声明。普通自然语言必须先进入
    // 主 Agent；只有结构化续跑、受控写入白名单或结构化 task/skill/workMode 才能在循环前声明
    // Photoshop 为硬依赖。真实 Tool 调用仍会在 ToolDecision/Preflight 处检查连接和文档状态。
    if (route === 'autonomous_agent') {
        return isStructuredAutonomousPhotoshopRequest(skillParams, structuredDecision);
    }
    if (route !== 'skill_execution') return false;
    return requiresPhotoshopForSkill(skillId, skillParams);
}

function canStartExecution(
    route: AgentRequestRoute,
    context: AgentRequestContextReadiness,
    skillId?: string,
    skillParams?: Record<string, unknown>,
    structuredDecision?: AgentRequestStructuredDecisionIdentity
): boolean {
    if (!requiresPhotoshop(route, skillId, skillParams, structuredDecision)) return true;
    if (capabilityBlocksExecution(resolveDeclaredCapabilityVerdict({
        declared: context.photoshopConnected,
        subjectLabel: '当前 Photoshop 运行时'
    }, '连接能力'))) return false;
    if (skillId === 'document-management') return true;
    return !capabilityBlocksExecution(resolveDeclaredCapabilityVerdict({
        declared: context.hasDocument,
        subjectLabel: '当前 Photoshop 运行时'
    }, '活动文档'));
}

function collectWarnings(
    input: BuildAgentRequestLifecycleInput,
    context: AgentRequestContextReadiness,
    structuredDecision: AgentRequestStructuredDecisionIdentity
): string[] {
    const warnings = Array.isArray(input.warnings) ? input.warnings.filter(Boolean) : [];
    const projectWarnings = input.context?.projectContext?.contextSnapshotWarnings || [];
    const projectLimitations = input.context?.projectContext?.contextSnapshotLimitations || [];

    const requiresPs = requiresPhotoshop(
        input.route,
        input.skillId,
        input.skillParams,
        structuredDecision
    );

    const photoshopConnectionBlocked = capabilityBlocksExecution(resolveDeclaredCapabilityVerdict({
        declared: context.photoshopConnected,
        subjectLabel: '当前 Photoshop 运行时'
    }, '连接能力'));
    const photoshopDocumentBlocked = capabilityBlocksExecution(resolveDeclaredCapabilityVerdict({
        declared: context.hasDocument,
        subjectLabel: '当前 Photoshop 运行时'
    }, '活动文档'));
    if (requiresPs && photoshopConnectionBlocked) {
        warnings.push('Photoshop 未连接，执行型请求可能无法开始。');
    }
    if (requiresPs && photoshopDocumentBlocked && input.skillId !== 'document-management') {
        warnings.push('当前没有打开文档，非文档创建/管理类任务需要先确认上下文。');
    }

    return [
        ...warnings,
        ...projectWarnings.filter(Boolean),
        ...projectLimitations.filter(Boolean)
    ];
}

export function buildAgentRequestLifecycle(
    input: BuildAgentRequestLifecycleInput
): AgentRequestLifecycleRecord {
    const rawText = normalizeText(input.userInput);
    const context = buildContextReadiness(input.context);
    const structuredDecision = resolveStructuredDecisionIdentity(input);
    const executionKind = input.executionKind || defaultExecutionKind(input.route);
    const requiresPs = requiresPhotoshop(
        input.route,
        input.skillId,
        input.skillParams,
        structuredDecision
    );
    const canStart = canStartExecution(
        input.route,
        context,
        input.skillId,
        input.skillParams,
        structuredDecision
    );
    const blockers = Array.isArray(input.blockers) ? input.blockers.filter(Boolean) : [];

    if (requiresPs && !canStart) {
        blockers.push('执行前上下文不足，需要补齐 Photoshop 连接或当前文档状态。');
    }
    const execution: AgentRequestExecutionState = {
        kind: executionKind,
        expectedExecutor: normalizeText(input.skillId) || undefined,
        requiresPhotoshop: requiresPs,
        canStart
    };
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
            ...structuredDecision,
            mode: normalizeText(input.mode) || undefined,
            intentSummary: normalizeText(input.intentSummary) || undefined,
            reason: normalizeText(input.reason) || '记录请求生命周期路由决策。'
        },
        execution,
        blockers,
        warnings: collectWarnings(input, context, structuredDecision),
        observations: [
            ...(Array.isArray(input.observations) ? input.observations : []),
            {
                source: 'design-agent-engine',
                summary: 'DesignAgentEngine 记录请求生命周期状态，不改变业务执行行为。'
            }
        ]
    };
}

export function withAgentRequestLifecycle<T extends { data?: unknown }>(
    result: T,
    lifecycle: AgentRequestLifecycleRecord
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
