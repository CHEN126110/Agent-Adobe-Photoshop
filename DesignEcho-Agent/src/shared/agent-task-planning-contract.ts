import type {
    AgentIntentControlPlaneDecision,
    AgentIntentRequestKind,
    AgentIntentToolScope
} from './agent-intent-control-plane';
import type {
    AgentRequestLifecycleEvidence,
    AgentRequestRoute
} from './agent-request-lifecycle';
import type { DesignAgentOsScenario } from './design-agent-os-contracts';

export type AgentTaskPlanningContractVersion = 'agent-task-planning-contract/v0';

export type AgentTaskPlanningContractStatus =
    | 'ready_direct_response'
    | 'blocked_needs_clarification'
    | 'ready_read_only_plan'
    | 'ready_for_controlled_execution_plan'
    | 'ready_for_model_planning';

export type AgentTaskPlanningStepPhase =
    | 'answer'
    | 'clarify'
    | 'inspect'
    | 'plan'
    | 'execute'
    | 'verify';

export interface AgentTaskPlanningContextInput {
    isPluginConnected?: boolean;
    photoshopContext?: {
        hasDocument?: boolean;
        documentName?: string;
        activeLayerName?: string;
        layerCount?: number;
    };
    projectContext?: {
        projectPath?: string;
        projectImageCount?: number;
    };
}

export interface AgentTaskPlanningBrief {
    scenario: DesignAgentOsScenario;
    goal: string;
    deliverables: string[];
    constraints: string[];
    needsProjectAssets: boolean;
    needsVisualEvidence: boolean;
    userVisibleSummary: string;
}

export interface AgentTaskPlanningStep {
    id: string;
    phase: AgentTaskPlanningStepPhase;
    action: string;
    allowedToolScope: AgentIntentToolScope;
    skillId?: string;
    requiresEvidence: string[];
    producesEvidence: string[];
    reason: string;
}

export interface AgentTaskPlanningExecutionPlan {
    mode: 'none' | 'read_only' | 'controlled_skill' | 'model_planning_required';
    canExecuteTools: boolean;
    requiresUserApproval: boolean;
    steps: AgentTaskPlanningStep[];
    verificationTargets: string[];
}

export interface BuildAgentTaskPlanningContractInput {
    userInput: unknown;
    intentControlPlane: AgentIntentControlPlaneDecision;
    lifecycle?: AgentRequestLifecycleEvidence;
    context?: AgentTaskPlanningContextInput;
    route?: AgentRequestRoute;
    skillId?: string;
    mode?: string;
    skillParams?: Record<string, unknown>;
}

export interface AgentTaskPlanningContract {
    version: AgentTaskPlanningContractVersion;
    status: AgentTaskPlanningContractStatus;
    requestKind: AgentIntentRequestKind;
    allowedToolScope: AgentIntentToolScope;
    route: AgentRequestRoute;
    skillId?: string;
    mode?: string;
    designBrief: AgentTaskPlanningBrief;
    executionPlan: AgentTaskPlanningExecutionPlan;
    requiredEvidence: string[];
    blockers: string[];
    warnings: string[];
    boundaries: string[];
    evidence: Array<{
        source: string;
        summary: string;
    }>;
    qualityClaim: {
        canClaimDesignComplete: false;
        canClaimOutputQuality: false;
    };
}

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(items: string[]): string[] {
    return Array.from(new Set(items.map(item => normalizeText(item)).filter(Boolean)));
}

function resolveRoute(input: BuildAgentTaskPlanningContractInput): AgentRequestRoute {
    return input.route || input.lifecycle?.decision?.route || (
        input.intentControlPlane.requestKind === 'clarify'
            ? 'clarification_needed'
            : input.intentControlPlane.shouldUseConversationalPath
                ? 'direct_response'
                : 'skill_execution'
    );
}

function resolveSkillId(input: BuildAgentTaskPlanningContractInput): string | undefined {
    return normalizeText(input.skillId) || normalizeText(input.lifecycle?.decision?.skillId) || undefined;
}

function inferScenario(input: {
    text: string;
    skillId?: string;
}): DesignAgentOsScenario {
    if (input.skillId === 'sku-batch' || /sku|SKU|自选备注|组合图|双装|单双装/.test(input.text)) return 'sku';
    if (input.skillId === 'main-image-design' || /主图|白底图|点击图|转化图/.test(input.text)) return 'main-image';
    if (input.skillId === 'detail-page-design' || /详情页|长图/.test(input.text)) return 'detail-page';
    if (input.skillId === 'layout-replication' || /参考图|复刻|照着|同款版式/.test(input.text)) return 'reference-replication';
    if (input.skillId === 'save-current-template' || /模板/.test(input.text)) return 'template';
    if (/文案|标题|卖点/.test(input.text)) return 'copywriting';
    if (input.skillId === 'project-image-analysis' || /项目|图片|素材/.test(input.text)) return 'general-design';
    return 'unknown';
}

function buildDeliverables(input: {
    text: string;
    skillId?: string;
    route: AgentRequestRoute;
    requestKind: AgentIntentRequestKind;
}): string[] {
    if (input.requestKind === 'chat_only' || input.requestKind === 'plan_only') return ['user_answer'];
    if (input.requestKind === 'clarify') return ['clarification_question'];
    if (input.skillId === 'project-image-analysis') {
        if (/都有什么|都有些什么|有些什么|都有啥|有哪些|资源|素材|文件夹/.test(input.text)) {
            return ['project_inventory'];
        }
        return ['project_overview'];
    }
    if (input.skillId === 'sku-batch' || /sku|SKU/.test(input.text)) {
        return ['sku_color_combinations', 'sku_self_select_notes'];
    }
    if (input.skillId === 'main-image-design' || /主图|白底图|点击图|转化图/.test(input.text)) {
        return ['main_image_design_plan', 'main_image_exports', 'main_image_psd'];
    }
    if (input.skillId === 'detail-page-design' || /详情页|长图/.test(input.text)) {
        return ['detail_page_design_plan', 'detail_page_exports'];
    }
    if (input.route === 'autonomous_agent') return ['model_generated_design_plan'];
    return ['controlled_skill_result'];
}

function buildConstraints(input: {
    text: string;
    skillId?: string;
    requestKind: AgentIntentRequestKind;
}): string[] {
    const constraints = [
        '先规划任务目标、证据和验收目标，再允许工具执行。',
        '工具执行成功不等于设计质量通过。',
        '不能输出或消费无依据的分数字段。'
    ];
    if (input.skillId === 'sku-batch' || /sku|SKU/.test(input.text)) {
        constraints.push(
            'SKU 素材优先来自当前项目中的 PSD/PSB 或项目素材索引，不默认使用用户已经打开但不属于项目的文档。',
            '默认 SKU 任务应同时考虑颜色组合和自选备注；用户明确排除时才取消备注。'
        );
    }
    if (input.requestKind === 'read_only_inspect') {
        constraints.push('只读检查不得写入 Photoshop 文档。');
    }
    return constraints;
}

function buildRequiredEvidence(input: {
    requestKind: AgentIntentRequestKind;
    route: AgentRequestRoute;
    skillId?: string;
}): string[] {
    if (input.requestKind === 'chat_only' || input.requestKind === 'plan_only') {
        return ['conversation_context'];
    }
    if (input.requestKind === 'clarify') {
        return ['clear_target', 'clear_action', 'clear_deliverable'];
    }
    if (input.skillId === 'project-image-analysis') {
        return ['project_context', 'project_asset_index'];
    }
    if (input.skillId === 'sku-batch') {
        return ['project_context', 'project_asset_index', 'project_sku_document', 'color_layer_evidence', 'verification_targets'];
    }
    if (input.skillId === 'main-image-design') {
        return ['project_context', 'project_asset_index', 'design_brief', 'visual_evidence', 'verification_targets'];
    }
    if (input.skillId === 'detail-page-design') {
        return ['project_context', 'detail_template_evidence', 'design_brief', 'visual_evidence', 'verification_targets'];
    }
    if (input.route === 'autonomous_agent') {
        return ['design_brief', 'context_snapshot', 'verification_targets', 'allowed_tool_scope'];
    }
    return ['context_snapshot', 'verification_targets'];
}

function step(
    id: string,
    phase: AgentTaskPlanningStepPhase,
    action: string,
    allowedToolScope: AgentIntentToolScope,
    details: {
        skillId?: string;
        requiresEvidence?: string[];
        producesEvidence?: string[];
        reason: string;
    }
): AgentTaskPlanningStep {
    return {
        id,
        phase,
        action,
        allowedToolScope,
        skillId: details.skillId,
        requiresEvidence: unique(details.requiresEvidence || []),
        producesEvidence: unique(details.producesEvidence || []),
        reason: details.reason
    };
}

function buildSteps(input: {
    status: AgentTaskPlanningContractStatus;
    skillId?: string;
    requiredEvidence: string[];
}): AgentTaskPlanningStep[] {
    if (input.status === 'ready_direct_response') {
        return [
            step('answer-user', 'answer', 'answerWithoutTools', 'none', {
                requiresEvidence: ['conversation_context'],
                producesEvidence: ['assistant_response'],
                reason: '用户请求不需要 Photoshop 或项目工具，直接回答。'
            })
        ];
    }
    if (input.status === 'blocked_needs_clarification') {
        return [
            step('clarify-target', 'clarify', 'askClarifyingQuestion', 'none', {
                requiresEvidence: ['clear_target', 'clear_action', 'clear_deliverable'],
                producesEvidence: ['clarification_question'],
                reason: '缺少目标、动作或交付物时不能默认调用工具。'
            })
        ];
    }
    if (input.status === 'ready_read_only_plan') {
        return [
            step('inspect-context', 'inspect', 'readContextEvidence', 'read_only', {
                skillId: input.skillId,
                requiresEvidence: ['project_context'],
                producesEvidence: ['readonly_inspection_result'],
                reason: '只读取项目、文档或图层证据，不写入 Photoshop。'
            }),
            step('summarize-readonly-result', 'verify', 'summarizeReadonlyEvidence', 'none', {
                requiresEvidence: ['readonly_inspection_result'],
                producesEvidence: ['user_visible_summary'],
                reason: '把只读结果转成用户可读结论。'
            })
        ];
    }
    if (input.status === 'ready_for_model_planning') {
        return [
            step('collect-context', 'inspect', 'collectContextBeforePlanning', 'read_only', {
                requiresEvidence: ['context_snapshot'],
                producesEvidence: ['planning_context'],
                reason: '开放式设计必须先读取当前上下文，不能直接碰工具。'
            }),
            step('build-model-plan', 'plan', 'requestModelDesignPlan', 'none', {
                requiresEvidence: input.requiredEvidence,
                producesEvidence: ['design_task_plan', 'public_plan', 'verification_targets'],
                reason: '先形成可审查设计计划、工具白名单和验收目标。'
            })
        ];
    }
    return [
        step('inspect-required-context', 'inspect', 'collectRequiredEvidence', 'read_only', {
            requiresEvidence: input.requiredEvidence,
            producesEvidence: ['planning_evidence'],
            reason: '业务设计执行前先读取项目、素材、文档和设计约束证据。'
        }),
        step('build-controlled-plan', 'plan', 'buildDesignBriefAndExecutionPlan', 'none', {
            requiresEvidence: ['planning_evidence'],
            producesEvidence: ['design_brief', 'execution_plan', 'verification_targets'],
            reason: '把用户目标转成可审查的设计简报和执行计划。'
        }),
        step('execute-controlled-skill', 'execute', 'executeControlledSkill', 'write_photoshop', {
            skillId: input.skillId,
            requiresEvidence: ['design_brief', 'execution_plan', 'verification_targets'],
            producesEvidence: ['execution_trace'],
            reason: '只有经过计划和门禁后，才允许调用受控业务 skill。'
        }),
        step('verify-result', 'verify', 'readBackAndVerifyResult', 'read_only', {
            requiresEvidence: ['execution_trace'],
            producesEvidence: ['verification_report'],
            reason: '执行后必须读回文档、导出或任务级证据。'
        })
    ];
}

function statusFor(input: {
    requestKind: AgentIntentRequestKind;
    route: AgentRequestRoute;
    skillId?: string;
}): AgentTaskPlanningContractStatus {
    if (input.requestKind === 'clarify' || input.route === 'clarification_needed') {
        return 'blocked_needs_clarification';
    }
    if (input.requestKind === 'chat_only' || input.requestKind === 'plan_only' || input.route === 'direct_response') {
        return 'ready_direct_response';
    }
    if (input.requestKind === 'read_only_inspect') {
        return 'ready_read_only_plan';
    }
    if (input.route === 'autonomous_agent' || input.skillId === 'autonomous-agent') {
        return 'ready_for_model_planning';
    }
    return 'ready_for_controlled_execution_plan';
}

function buildBlockers(status: AgentTaskPlanningContractStatus): string[] {
    if (status !== 'blocked_needs_clarification') return [];
    return ['missing_target', 'missing_action', 'missing_deliverable'];
}

function buildWarnings(input: {
    status: AgentTaskPlanningContractStatus;
    requestKind: AgentIntentRequestKind;
    skillId?: string;
}): string[] {
    const warnings: string[] = [];
    if (input.status === 'ready_for_model_planning') {
        warnings.push('开放式设计请求需要模型或人工先形成公开计划，不能直接进入自主工具循环。');
    }
    if (input.skillId === 'sku-batch') {
        warnings.push('SKU 执行计划只表达任务边界，不替代项目 SKU 文件、颜色图层和导出结果读回。');
    }
    if (input.requestKind === 'read_only_inspect') {
        warnings.push('只读计划不能升级为 Photoshop 写入。');
    }
    return warnings;
}

export function buildAgentTaskPlanningContract(
    input: BuildAgentTaskPlanningContractInput
): AgentTaskPlanningContract {
    const text = normalizeText(input.userInput);
    const route = resolveRoute(input);
    const skillId = resolveSkillId(input);
    const requestKind = input.intentControlPlane.requestKind;
    const allowedToolScope = input.intentControlPlane.toolScope;
    const status = statusFor({ requestKind, route, skillId });
    const scenario = inferScenario({ text, skillId });
    const deliverables = buildDeliverables({ text, skillId, route, requestKind });
    const requiredEvidence = buildRequiredEvidence({ requestKind, route, skillId });
    const steps = buildSteps({ status, skillId, requiredEvidence });

    return {
        version: 'agent-task-planning-contract/v0',
        status,
        requestKind,
        allowedToolScope,
        route,
        skillId,
        mode: normalizeText(input.mode || input.lifecycle?.decision?.mode) || undefined,
        designBrief: {
            scenario,
            goal: text || '未提供明确任务目标。',
            deliverables,
            constraints: buildConstraints({ text, skillId, requestKind }),
            needsProjectAssets: ['sku', 'main-image', 'detail-page'].includes(scenario) || skillId === 'project-image-analysis',
            needsVisualEvidence: ['sku', 'main-image', 'detail-page', 'reference-replication'].includes(scenario),
            userVisibleSummary: input.intentControlPlane.userVisibleSummary
        },
        executionPlan: {
            mode: status === 'ready_direct_response' || status === 'blocked_needs_clarification'
                ? 'none'
                : status === 'ready_read_only_plan'
                    ? 'read_only'
                    : status === 'ready_for_model_planning'
                        ? 'model_planning_required'
                        : 'controlled_skill',
            canExecuteTools: status === 'ready_read_only_plan' || status === 'ready_for_controlled_execution_plan',
            requiresUserApproval: status === 'ready_for_model_planning',
            steps,
            verificationTargets: unique([
                status === 'ready_direct_response' ? 'assistant_response_matches_user_question' : '',
                status === 'ready_read_only_plan' ? 'readonly_summary_matches_project_or_document_evidence' : '',
                status === 'ready_for_controlled_execution_plan' ? 'execution_trace_exists' : '',
                status === 'ready_for_controlled_execution_plan' ? 'readback_or_export_result_exists' : '',
                status === 'ready_for_model_planning' ? 'model_plan_has_public_steps_and_verification_targets' : ''
            ])
        },
        requiredEvidence,
        blockers: buildBlockers(status),
        warnings: buildWarnings({ status, requestKind, skillId }),
        boundaries: [
            'AgentTaskPlan 是请求级规划证据，不直接执行 Photoshop。',
            '没有 DesignBrief、ExecutionPlan 和 VerificationTarget 时，不能把模型输出直接当工具动作。',
            '该契约不声明设计质量通过，也不使用无依据评分。'
        ],
        evidence: [
            {
                source: 'agent-intent-control-plane',
                summary: `requestKind=${requestKind}; toolScope=${allowedToolScope}`
            },
            {
                source: 'agent-request-lifecycle',
                summary: `route=${route}; skill=${skillId || 'none'}`
            }
        ],
        qualityClaim: {
            canClaimDesignComplete: false,
            canClaimOutputQuality: false
        }
    };
}
