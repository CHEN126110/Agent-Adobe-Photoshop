import type { AgentRequestRoute, AgentRequestRouteSource } from './agent-request-lifecycle';
import type { DesignAgentOsScenario } from './design-agent-os-contracts';
import {
    buildDesignIntelligencePlan,
    type DesignIntelligenceAgentDecision,
    type DesignIntelligencePlan
} from './design-intelligence-plan';
import type { DesignKnowledgeResult } from './design-knowledge-search';

export type AgentDesignExecutionPreflightStatus =
    | 'not_applicable'
    | 'ready_for_execution'
    | 'needs_model_design_decision'
    | 'needs_visual_evidence'
    | 'blocked';

export interface AgentDesignExecutionPreflightContext {
    projectPath?: string;
    projectImageCount?: number;
    sampleImagePaths?: string[];
    assetIndex?: {
        summary?: {
            totalImages?: number;
        };
    };
    visualInsightCache?: {
        summary?: {
            entriesWithInsight?: number;
        };
    };
    visualSamplingPlan?: {
        cacheSummary?: {
            shouldAnalyze?: number;
        };
    };
}

export interface BuildAgentDesignExecutionPreflightInput {
    userText?: string;
    route: AgentRequestRoute;
    routeSource: AgentRequestRouteSource;
    skillId?: string;
    mode?: string;
    params?: Record<string, unknown>;
    projectContext?: AgentDesignExecutionPreflightContext | null;
    knowledgeResults?: DesignKnowledgeResult[];
    agentDecision?: DesignIntelligenceAgentDecision | null;
}

export interface AgentDesignExecutionPreflight {
    version: 'agent-design-execution-preflight/v0';
    status: AgentDesignExecutionPreflightStatus;
    route: AgentRequestRoute;
    routeSource: AgentRequestRouteSource;
    skillId?: string;
    scenario?: DesignAgentOsScenario;
    appliesToSkill: boolean;
    readOnlyBypass: boolean;
    shouldExecute: boolean;
    requiredBeforeExecution: string[];
    blockers: string[];
    warnings: string[];
    designIntelligencePlan?: DesignIntelligencePlan;
    boundaries: string[];
    limitations: string[];
}

const SKILL_SCENARIO_MAP: Record<string, DesignAgentOsScenario> = {
    'main-image-design': 'main-image',
    'detail-page-design': 'detail-page',
    'sku-batch': 'sku'
};

const CONTROLLED_PRODUCTION_SKILLS_WITH_OWN_PLANNER = new Set([
    'sku-batch'
]);

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function numberOrZero(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function extractAgentDecision(params: Record<string, unknown> = {}): DesignIntelligenceAgentDecision | null {
    const candidates = [
        params.designIntelligenceDecision,
        params.designAgentDecision,
        params.agentDesignDecision
    ];
    const decision = candidates.find((item) => item && typeof item === 'object' && !Array.isArray(item));
    return decision ? decision as DesignIntelligenceAgentDecision : null;
}

function isReadOnlyBypass(input: BuildAgentDesignExecutionPreflightInput): boolean {
    const params = input.params || {};
    const mode = cleanString(input.mode || params.mode || params.detailMode).toLowerCase();
    return mode === 'inspect'
        || params.inspectOnly === true
        || params.dryRun === true
        || params.strategyOnly === true
        || cleanString(params.mainImageExecutionMode).toLowerCase() === 'strategy-only';
}

function requiresGenericDesignDecision(input: BuildAgentDesignExecutionPreflightInput): boolean {
    const params = input.params || {};
    const mode = cleanString(input.mode || params.mode || params.detailMode || params.executionMode).toLowerCase();
    return params.requiresDesignIntelligenceDecision === true
        || params.requiresGenericDesignDecision === true
        || mode === 'creative-design'
        || mode === 'open-design'
        || mode === 'redesign';
}

function shouldUseControlledProductionPlanner(
    input: BuildAgentDesignExecutionPreflightInput,
    scenario?: DesignAgentOsScenario
): boolean {
    const skillId = cleanString(input.skillId);
    return input.route === 'skill_execution'
        && scenario === 'sku'
        && CONTROLLED_PRODUCTION_SKILLS_WITH_OWN_PLANNER.has(skillId)
        && !requiresGenericDesignDecision(input);
}

function normalizeProjectContext(
    projectContext?: AgentDesignExecutionPreflightContext | null
): AgentDesignExecutionPreflightContext {
    const projectImageCount = numberOrZero(projectContext?.projectImageCount)
        || numberOrZero(projectContext?.assetIndex?.summary?.totalImages)
        || (Array.isArray(projectContext?.sampleImagePaths) ? projectContext.sampleImagePaths.length : 0);
    return {
        ...projectContext,
        projectImageCount,
        assetIndex: {
            ...projectContext?.assetIndex,
            summary: {
                ...projectContext?.assetIndex?.summary,
                totalImages: numberOrZero(projectContext?.assetIndex?.summary?.totalImages) || projectImageCount
            }
        }
    };
}

function mapPlanStatus(status?: DesignIntelligencePlan['status']): AgentDesignExecutionPreflightStatus {
    if (status === 'ready_for_tool_planning') return 'ready_for_execution';
    if (status === 'needs_model_design_decision') return 'needs_model_design_decision';
    if (status === 'needs_visual_evidence') return 'needs_visual_evidence';
    if (status === 'blocked') return 'blocked';
    return 'blocked';
}

export function getAgentDesignExecutionScenario(skillId?: string): DesignAgentOsScenario | undefined {
    return SKILL_SCENARIO_MAP[cleanString(skillId)];
}

export function shouldApplyAgentDesignExecutionPreflight(skillId?: string): boolean {
    return Boolean(getAgentDesignExecutionScenario(skillId));
}

export function buildAgentDesignExecutionPreflight(
    input: BuildAgentDesignExecutionPreflightInput
): AgentDesignExecutionPreflight {
    const skillId = cleanString(input.skillId) || undefined;
    const scenario = getAgentDesignExecutionScenario(skillId);
    const appliesToSkill = Boolean(scenario);
    const readOnlyBypass = isReadOnlyBypass(input);
    const commonBoundaries = [
        '任务级设计 preflight 只决定是否允许进入业务 skill 执行，不直接调用 Photoshop。',
        '模型/人工设计决策必须先说明目标、层级、配色、字体、修图、选图和验收标准。',
        '知识库、用户偏好和网页信息只能作为设计上下文，不能直接变成 Photoshop 写入动作。'
    ];
    const commonLimitations = [
        '该门禁不能证明最终视觉质量。',
        '工具执行成功后仍需要读回、截图、像素或人工验收。',
        '只读检查、模板创建、文档管理和调试类能力不属于业务设计写入门禁。'
    ];

    if (!appliesToSkill || !scenario) {
        return {
            version: 'agent-design-execution-preflight/v0',
            status: 'not_applicable',
            route: input.route,
            routeSource: input.routeSource,
            skillId,
            appliesToSkill: false,
            readOnlyBypass: false,
            shouldExecute: true,
            requiredBeforeExecution: [],
            blockers: [],
            warnings: [],
            boundaries: commonBoundaries,
            limitations: commonLimitations
        };
    }

    if (readOnlyBypass) {
        return {
            version: 'agent-design-execution-preflight/v0',
            status: 'not_applicable',
            route: input.route,
            routeSource: input.routeSource,
            skillId,
            scenario,
            appliesToSkill: true,
            readOnlyBypass: true,
            shouldExecute: true,
            requiredBeforeExecution: [],
            blockers: [],
            warnings: ['当前是只读检查或策略草案请求，不要求业务写入前设计决策。'],
            boundaries: commonBoundaries,
            limitations: commonLimitations
        };
    }

    if (shouldUseControlledProductionPlanner(input, scenario)) {
        return {
            version: 'agent-design-execution-preflight/v0',
            status: 'ready_for_execution',
            route: input.route,
            routeSource: input.routeSource,
            skillId,
            scenario,
            appliesToSkill: true,
            readOnlyBypass: false,
            shouldExecute: true,
            requiredBeforeExecution: [
                'project-first-sku-source-resolution',
                'sku-template-and-config-evidence',
                'sku-controlled-execution-plan',
                'sku-result-readback'
            ],
            blockers: [],
            warnings: [
                'SKU 批量生产使用 SKU 专用项目证据和执行计划，不要求通用视觉设计决策。'
            ],
            boundaries: [
                ...commonBoundaries,
                'SKU 专用执行计划必须优先使用当前项目中的 SKU 文档、模板文件和配置文件。'
            ],
            limitations: [
                ...commonLimitations,
                '该门禁只允许进入 SKU 专用 executor，实际文件存在性、模板匹配、组合数量和导出结果仍由 SKU executor 验证。'
            ]
        };
    }

    const params = input.params || {};
    const agentDecision = input.agentDecision || extractAgentDecision(params);
    const designIntelligencePlan = buildDesignIntelligencePlan({
        userText: input.userText,
        scenario,
        plannerReadiness: agentDecision ? 'ready' : 'needs_context',
        knowledgeResults: input.knowledgeResults,
        projectContext: normalizeProjectContext(input.projectContext),
        agentDecision
    });
    const status = mapPlanStatus(designIntelligencePlan.status);
    const blockers = [
        ...designIntelligencePlan.blockers,
        ...(status === 'needs_model_design_decision'
            ? ['缺少模型或人工设计决策，不能把业务 skill 当成工具直接执行。']
            : []),
        ...(status === 'needs_visual_evidence'
            ? ['缺少项目视觉证据，不能执行会影响主图、详情页或 SKU 的设计写入。']
            : [])
    ];

    return {
        version: 'agent-design-execution-preflight/v0',
        status,
        route: input.route,
        routeSource: input.routeSource,
        skillId,
        scenario,
        appliesToSkill: true,
        readOnlyBypass: false,
        shouldExecute: status === 'ready_for_execution',
        requiredBeforeExecution: designIntelligencePlan.toolUsePlan.requiredBeforeExecution,
        blockers,
        warnings: designIntelligencePlan.warnings,
        designIntelligencePlan,
        boundaries: commonBoundaries,
        limitations: commonLimitations
    };
}
